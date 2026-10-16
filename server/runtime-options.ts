import { isIP } from 'node:net';

export interface RuntimeOptions {
  host: string;
  port: number;
  serveStatic: boolean;
  trustedProxies?: string[];
}

export function parseRuntimeOptions(args: string[]): RuntimeOptions {
  const options: RuntimeOptions = { host: '127.0.0.1', port: 3001, serveStatic: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--production') options.serveStatic = true;
    else if (argument === '--trusted-proxy') {
      const value = args[++index];
      if (!value || !isIP(value)) throw new Error('--trusted-proxy requiere la dirección IP exacta del proxy.');
      (options.trustedProxies ??= []).push(value);
    } else if (argument === '--host') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Falta el valor de --host.');
      options.host = value;
    } else if (argument === '--port') {
      const value = args[++index];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('--port debe estar entre 1 y 65535.');
      options.port = Number(value);
    } else throw new Error(`Argumento no reconocido: ${argument}`);
  }
  return options;
}
