from fastapi import Depends
from modal import App, Image, Secret, Volume, enter, fastapi_endpoint, method
from pydantic import BaseModel
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

MAX_FILE_SIZE = 5e7  # 50mb
IDLE_TIMEOUT = 3 * 60  # 3 minutes

WHISPER_MODEL = "large-v3-turbo"
MODEL_DIR = "/models"

model_volume = Volume.from_name(
    "mt-whisper-models",
    create_if_missing=True,
)

app = App(name="mira-transcribe")

image = Image.debian_slim(python_version="3.12").uv_pip_install(
    "faster-whisper==1.2.1",
    "librosa==0.11.0",
    "pydantic==2.13.1",
    "fastapi[standard]",
    "nvidia-cublas-cu12",
    "nvidia-cudnn-cu12",
)

mt_secret = Secret.from_name("mt-api")

auth_scheme = HTTPBearer()


class TranscriptionRequest(BaseModel):
    url: str

class TranscriptionResponse(BaseModel):
    text: str
    lang: str


@app.local_entrypoint()
def main(audio_url: str):
    import requests

    response = requests.get(audio_url, timeout=5)
    result = Transcriber().transcribe.remote(response.content)
    print(result)


@app.function(
    image=image,
    volumes={MODEL_DIR: model_volume},
)
def download_model():
    import faster_whisper

    faster_whisper.download_model(
        WHISPER_MODEL,
        cache_dir=MODEL_DIR,
    )


@app.cls(
    image=image,
    gpu="T4",
    volumes={MODEL_DIR: model_volume},
    scaledown_window=IDLE_TIMEOUT,
    secrets=[mt_secret],
    enable_memory_snapshot=True,
    experimental_options={"enable_gpu_snapshot": True},
    env={
        "LD_LIBRARY_PATH": ":".join(
            [
                "/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib",
                "/usr/local/lib/python3.12/site-packages/nvidia/cudnn/lib",
            ]
        ),
    },
)
class Transcriber:
    @enter(snap=True)
    def load_model(self):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(
            WHISPER_MODEL,
            local_files_only=True,
            download_root=MODEL_DIR,
            compute_type="float16",
            device="cuda",
        )

    @fastapi_endpoint(method="POST")
    def transcribe_endpoint(
        self,
        body: TranscriptionRequest,
        token: HTTPAuthorizationCredentials = Depends(auth_scheme),
    ) -> TranscriptionResponse:
        import os
        import requests
        from fastapi import HTTPException

        if token.credentials != os.environ["API_KEY"]:
            raise HTTPException(
                status_code=401,
            )

        res = requests.head(body.url, timeout=5)
        content_length = int(res.headers.get("content-length", "0"))
        content_type = res.headers.get("content-type", "")

        if (
            not content_type.startswith("audio/")
            or content_length == 0
            or content_length > MAX_FILE_SIZE
        ):
            raise HTTPException(status_code=400)

        res = requests.get(body.url, timeout=5)
        return self.transcribe.local(res.content)

    @method()
    def transcribe(self, audio_bytes: bytes) -> TranscriptionResponse:
        import io
        import librosa

        audio_data, _ = librosa.load(io.BytesIO(audio_bytes), sr=16000)
        segments, info = self.model.transcribe(audio_data)

        return TranscriptionResponse(
            text="".join(map(lambda s: s.text, segments)).strip(),
            lang=info.language,
        )
