import {OpenRouter} from '@openrouter/sdk';

import {config} from './config';

export type TranscriptionResponse = {
  text: string;
  lang: string;
};

export const transcribe = async (url: string, contentType?: string) =>
  config.transcription.use_modal
    ? transcribeModal(url)
    : transcribeOpenRouter(url, contentType);

export const transcribeModal = async (url: string) => {
  const res = await fetch(config.transcription.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.transcription.api_key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({url}),
  });

  if (!res.ok) {
    throw await res.text();
  }

  return res.json() as Promise<TranscriptionResponse>;
};

const transcribeOpenRouter = async (url: string, contentType?: string) => {
  const head = await fetch(url, {
    method: 'HEAD',
  });

  const fileSize = Number(head.headers.get('content-length') || Infinity);
  if (fileSize > 5e7) {
    console.error('file too big', fileSize);
    throw new Error('File too big');
  }

  const res = await fetch(url);
  if (!res.ok) {
    console.error('failed to download audio:', await res.text());
    throw new Error('not ok');
  }
  const file = await res.arrayBuffer();
  const fileName = new URL(url).pathname.split('/').pop()!;
  const fileExtension = fileName.split('.').pop();
  const fileType = contentType?.split('/').pop() || fileExtension!;

  const or = new OpenRouter({
    apiKey: config.provider.api_key,
  });

  const transcription = await or.stt.createTranscription({
    sttRequest: {
      model: 'openai/whisper-large-v3-turbo',
      inputAudio: {
        data: Buffer.from(file).toString('base64'),
        format: fileType,
      },
      provider: {
        options: {
          groq: {
            prompt:
              'We use all the standard punctuation and capitalization rules of the English language. Sentences start with a capital letter, and end with a full stop. Of course, where appropriate, commas are included. The pronoun "I" should be capitalized!',
          },
        },
      },
    },
  });

  return {
    // lang: transcription.language || 'en',
    lang: 'en',
    text: transcription.text,
  };
};
