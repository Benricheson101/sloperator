import {tool} from 'ai';
import {evaluate} from 'mathjs';
import {z} from 'zod';

export const evalMathExpr = tool({
  description:
    'Evaluate a mathjs math expression. Supports functions like sin, cos, log, sqrt, constants like pi and e, and operations, as well as conversions like "5cm to inches"',

  inputSchema: z.object({
    expr: z.string().describe('The math expression to evaluate'),
  }),

  execute: ({expr}) => evaluate(expr).toString(),
});
