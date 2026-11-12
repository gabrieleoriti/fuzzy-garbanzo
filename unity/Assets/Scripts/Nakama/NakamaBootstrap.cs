// Drop on any GameObject in your first scene. Requires the Nakama Unity SDK:
//   Packages/manifest.json -> "com.heroiclabs.nakama-unity":
//     "https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama#v3.23.0"
using System;
using Nakama;
using UnityEngine;

namespace Game.Networking
{
    public class NakamaBootstrap : MonoBehaviour
    {
        [Header("Server (matches docker-compose.yml / .env)")]
        [SerializeField] private string scheme = "http";
        [SerializeField] private string host = "127.0.0.1"; // Android emulator: 10.0.2.2; device: your LAN IP
        [SerializeField] private int port = 7350;
        [SerializeField] private string serverKey = "defaultkey";

        private const string AuthTokenKey = "nakama.authToken";
        private const string RefreshTokenKey = "nakama.refreshToken";

        public IClient Client { get; private set; }
        public ISession Session { get; private set; }

        private async void Start()
        {
            Client = new Client(scheme, host, port, serverKey, UnityWebRequestAdapter.Instance);

            try
            {
                var result = await NakamaAuthFlow.RunAsync(
                    Client,
                    GetDeviceId(),
                    c => c.NewSocket(useMainThread: true),
                    msg => Debug.Log("[Nakama] " + msg));

                Session = result.Session;
                PlayerPrefs.SetString(AuthTokenKey, Session.AuthToken);
                PlayerPrefs.SetString(RefreshTokenKey, Session.RefreshToken);
                PlayerPrefs.Save();
                Debug.Log("[Nakama] Unity client authenticated against local stack.");
            }
            catch (ApiResponseException e)
            {
                Debug.LogError($"[Nakama] API error {e.StatusCode} (grpc {e.GrpcStatusCode}): {e.Message}");
            }
            catch (Exception e)
            {
                Debug.LogError("[Nakama] " + e);
            }
        }

        private static string GetDeviceId()
        {
            // deviceUniqueIdentifier is unsupported on WebGL and can be empty; fall back
            // to a persisted GUID. Nakama requires 10-128 characters.
            var id = SystemInfo.deviceUniqueIdentifier;
            if (string.IsNullOrEmpty(id) || id == SystemInfo.unsupportedIdentifier)
            {
                id = PlayerPrefs.GetString("nakama.deviceId", Guid.NewGuid().ToString());
                PlayerPrefs.SetString("nakama.deviceId", id);
            }
            return id;
        }
    }
}
