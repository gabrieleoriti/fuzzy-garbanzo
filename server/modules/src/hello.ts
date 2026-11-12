interface HelloResponse {
  message: string;
  userId: string;
  username: string;
  serverTimeUnixMs: number;
}

/**
 * RPC "hello_world". Requires an authenticated session and echoes back who the
 * server thinks the caller is: the end-to-end proof that client auth works.
 * Optional payload: {"name": "..."}.
 */
const rpcHelloWorld: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  if (!ctx.userId) {
    throw { message: 'authentication required', code: nkruntime.Codes.UNAUTHENTICATED } as nkruntime.Error;
  }

  const username = ctx.username || '';
  let name = username;
  if (payload) {
    let req: any;
    try {
      req = JSON.parse(payload);
    } catch (e) {
      throw { message: 'payload must be JSON', code: nkruntime.Codes.INVALID_ARGUMENT } as nkruntime.Error;
    }
    if (req && typeof req.name === 'string' && req.name.length > 0) {
      name = req.name;
    }
  }

  logger.info('hello_world called by %s (%s)', ctx.username, ctx.userId);

  const res: HelloResponse = {
    message: 'Hello, ' + name + '!',
    userId: ctx.userId,
    username: username,
    serverTimeUnixMs: Date.now(),
  };
  return JSON.stringify(res);
};

const afterAuthenticateDevice: nkruntime.AfterHookFunction<nkruntime.Session, nkruntime.AuthenticateDeviceRequest> =
  function (ctx, logger, nk, session, req) {
    logger.info('device auth ok: user=%s created=%s', ctx.userId, String(session.created));
  };
