// Headless stand-in for the Unity client: runs NakamaAuthFlow.cs (shared with
// unity/Assets) against the local stack and asserts on the results.
// Exit code 0 = Unity-equivalent client can authenticate and use the session.
using System.Text.Json;
using Game.Networking;
using Nakama;

var host = Environment.GetEnvironmentVariable("NAKAMA_HOST") ?? "127.0.0.1";
var port = int.Parse(Environment.GetEnvironmentVariable("NAKAMA_PORT") ?? "7350");
var serverKey = Environment.GetEnvironmentVariable("NAKAMA_SERVER_KEY") ?? "defaultkey";
var deviceId = Environment.GetEnvironmentVariable("DEVICE_ID") ?? "client-check-" + Guid.NewGuid();

var failures = new List<string>();
void Check(bool ok, string what) { Console.WriteLine($"  [{(ok ? "PASS" : "FAIL")}] {what}"); if (!ok) failures.Add(what); }

Console.WriteLine($"Nakama at http://{host}:{port}, device_id={deviceId}");

// --- Happy path: the shared Unity flow ----------------------------------------
var client = new Client("http", host, port, serverKey);
// WebSocketStdlibAdapter (System.Net.WebSockets) instead of the default adapter:
// the default opens an IPv6 dual-stack TCP socket, which fails on IPv6-less
// hosts such as some CI containers. Unity supplies its own via NewSocket().
var result = await NakamaAuthFlow.RunAsync(
    client, deviceId, c => Socket.From(c, new WebSocketStdlibAdapter()), m => Console.WriteLine("  " + m));

var hello = JsonDocument.Parse(result.HelloRpcPayload).RootElement;
Console.WriteLine("Checks:");
Check(!string.IsNullOrEmpty(result.Session.AuthToken), "session has an access token");
Check(!string.IsNullOrEmpty(result.Session.RefreshToken), "session has a refresh token");
Check(result.Account.User.Id == result.Session.UserId, "account fetched with session matches session user");
Check(hello.GetProperty("userId").GetString() == result.Session.UserId, "TS module RPC sees the authenticated user id");
Check(hello.GetProperty("message").GetString() == "Hello, Unity!", "TS module RPC returns hello payload");
Check(result.SocketConnected, "realtime socket accepted the session");
Check(result.RefreshSucceeded, "refresh token exchanged for a new session");

// Re-auth with the same device must return the same account, not create a new one.
var again = await client.AuthenticateDeviceAsync(deviceId, create: true);
Check(again.UserId == result.Session.UserId && !again.Created, "re-auth with same device id returns same account");

// --- Negative paths: the server actually enforces auth -------------------------
try
{
    await new Client("http", host, port, "wrong-server-key").AuthenticateDeviceAsync(deviceId);
    Check(false, "wrong server key is rejected");
}
catch (ApiResponseException e) { Check(e.StatusCode == 401, $"wrong server key is rejected (HTTP {e.StatusCode})"); }

try
{
    var forged = Session.Restore(result.Session.AuthToken[..^4] + "AAAA", null);
    await client.RpcAsync(forged, NakamaAuthFlow.HelloRpcId);
    Check(false, "tampered session token is rejected");
}
catch (ApiResponseException e) { Check(e.StatusCode == 401, $"tampered session token is rejected (HTTP {e.StatusCode})"); }

Console.WriteLine(failures.Count == 0 ? "RESULT: PASS" : $"RESULT: FAIL ({failures.Count})");
return failures.Count == 0 ? 0 : 1;
