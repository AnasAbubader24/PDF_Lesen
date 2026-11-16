import http from 'node:http';
import https from 'node:https';

const secure = process.env.LOCAL_HTTPS === '1';
// Probe only loopback; local development CAs need not be installed in the image.
const request = (secure ? https : http).get({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 3001),
  path: '/api/health',
  ...(secure ? { rejectUnauthorized: false } : {}),
  timeout: 4000,
}, response => {
  response.resume();
  process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on('timeout', () => request.destroy(new Error('Health check timed out')));
request.on('error', () => { process.exitCode = 1; });
