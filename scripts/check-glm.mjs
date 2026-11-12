#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { quotaRequest, parseQuotaResponse, resetRequest, parseResetResponse } from '../src/glm.js';

try {
  const apiKey = process.env.GLM_API_KEY || await readFile(new URL('../.secrets/glm-api-key', import.meta.url), 'utf8');
  const result = {};
  const jobs = [
    ['quota', quotaRequest(apiKey), parseQuotaResponse],
    ['resets', resetRequest(apiKey), parseResetResponse]
  ];
  const outcomes = await Promise.allSettled(jobs.map(async ([name, request, parse]) => {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.header,
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('HTTP');
    result[name] = parse(await response.text());
  }));
  for (let index = 0; index < outcomes.length; index++) {
    if (outcomes[index].status === 'rejected') {
      result[jobs[index][0]] = null;
      console.error((index === 0 ? '额度' : '重置次数') + '查询失败（未输出响应或凭证）');
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const message = error.code === 'ENOENT' ? '缺少本机 Key 文件：.secrets/glm-api-key' :
    error.name === 'TimeoutError' || error.name === 'AbortError' ? 'GLM 查询超时，请稍后重试' :
      ['KEY_REQUIRED', 'AUTH', 'RATE_LIMIT', 'API_ERROR', 'INVALID_DATA', 'NO_QUOTA'].indexOf(error.code) >= 0 ? error.message :
        'GLM 查询失败，请检查网络连接';
  console.error(message);
  process.exitCode = 1;
}
