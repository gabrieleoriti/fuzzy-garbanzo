// Engine-agnostic auth flow against the Nakama stack in docker-compose.yml.
// No UnityEngine references on purpose: the same file is compiled by the Unity
// project (via NakamaBootstrap.cs) and by client-check/ (a .NET console harness
// that proves the flow without opening the Unity editor).
using System;
using System.Linq;
using System.Threading.Tasks;
using Nakama;

namespace Game.Networking
{
    public sealed class NakamaAuthResult
    {
        public ISession Session;
        public IApiAccount Account;
        public string HelloRpcPayload;
        public bool SocketConnected;
        public bool RefreshSucceeded;
    }

    public static class NakamaAuthFlow
    {
        public const string HelloRpcId = "hello_world";

        /// <summary>
        /// Device-authenticates (creating the account on first run), then exercises
        /// the session against every surface a game will use: REST (account),
        /// the TypeScript runtime (RPC), realtime (socket) and token refresh.
        /// </summary>
        public static async Task<NakamaAuthResult> RunAsync(
            IClient client,
            string deviceId,
            Func<IClient, ISocket> socketFactory,
            Action<string> log)
        {
            var result = new NakamaAuthResult();

            // 1. Authenticate. Nakama requires device IDs of 10-128 chars.
            var session = await client.AuthenticateDeviceAsync(deviceId, create: true);
            result.Session = session;
            log($"authenticated: user_id={session.UserId} username={session.Username} new_account={session.Created} expires_utc={DateTimeOffset.FromUnixTimeSeconds(session.ExpireTime):u}");

            // 2. Authenticated REST call.
            var account = await client.GetAccountAsync(session);
            result.Account = account;
            log($"account: id={account.User.Id} devices={account.Devices.Count()}");

            // 3. Call the TypeScript module's RPC with the session token.
            var rpc = await client.RpcAsync(session, HelloRpcId, "{\"name\":\"Unity\"}");
            result.HelloRpcPayload = rpc.Payload;
            log($"rpc {HelloRpcId}: {rpc.Payload}");

            // 4. Realtime socket with the same session.
            var socket = socketFactory(client);
            await socket.ConnectAsync(session, appearOnline: true);
            result.SocketConnected = socket.IsConnected;
            log($"socket connected: {socket.IsConnected}");
            await socket.CloseAsync();

            // 5. Refresh-token round trip (what the game does when the access token expires).
            var refreshed = await client.SessionRefreshAsync(session);
            result.RefreshSucceeded = refreshed.UserId == session.UserId && !refreshed.IsExpired;
            result.Session = refreshed;
            log($"refresh ok: {result.RefreshSucceeded}");

            return result;
        }
    }
}
