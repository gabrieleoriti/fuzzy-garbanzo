// Nakama's JS runtime calls the global InitModule function at startup.
function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
) {
  initializer.registerRpc('hello_world', rpcHelloWorld);
  initializer.registerAfterAuthenticateDevice(afterAuthenticateDevice);
  logger.info('hello-world TypeScript module loaded');
}
