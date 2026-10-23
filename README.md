# Smart room

Two layers. The control pane creates rooms, images, and calendar connections. The Android panel fetches that room and joins meetings on the device.

## Run the control pane

```powershell
npm install --prefix services/api
npm install --prefix apps/admin
npm install --prefix apps/share-web
npm install --prefix apps/whiteboard-web
copy services\api\.env.example services\api\.env
npm run dev:api
npm run dev:admin
npm run dev:share
npm run dev:whiteboard
```

Open http://localhost:5173 and sign in with the `ADMIN_PASSWORD` in `services/api/.env` (local default `change-me`).

Create a room, set its name and background, then click Connect. The token lasts 10 minutes and works once. Type it into the panel with the control server address the panel can reach. Use the computer's LAN address in `PUBLIC_API_URL` when the panel is not on the same machine as localhost.

## Configuration

Copy `services/api/.env.example` to `services/api/.env`. Restart the API after any change. Calendar connections are optional. A room with no connected account shows an empty meeting list.

| Variable | Purpose |
| --- | --- |
| `PUBLIC_API_URL` | Address the panel uses for images and the control API. Use the computer's LAN address when the panel is another device. |
| `ADMIN_ORIGIN` | Admin site the browser returns to after Google or Microsoft sign-in. Default `http://localhost:5173`. |
| `SHARE_WEB_ORIGIN` | Share page origin, with no path and no code. Default `http://localhost:5174`. |
| `WHITEBOARD_WEB_ORIGIN` | Whiteboard page origin, with no path and no code. Default `http://localhost:5175`. |
| `ADMIN_PASSWORD` | Admin sign-in password. |
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret from Google Cloud. |
| `GOOGLE_REDIRECT_URI` | Must match the redirect URI registered on that client. Default `http://localhost:4000/api/oauth/google/callback`. |
| `MICROSOFT_CLIENT_ID` | Application (client) ID from the Entra app registration. |
| `MICROSOFT_CLIENT_SECRET` | Client secret value from that registration. |
| `MICROSOFT_REDIRECT_URI` | Must match the redirect URI on that registration. Default `http://localhost:4000/api/oauth/microsoft/callback`. |

The share site has its own file, `apps/share-web/.env`. Set `API_URL` to the control API, for example `http://localhost:4000`. Set `VITE_API_URL` only when a built share site is hosted on a different origin than the API.

The whiteboard page is `apps/whiteboard-web`. Copy `apps/whiteboard-web/.env.example` to `apps/whiteboard-web/.env` and set `API_URL` the same way. Set `VITE_API_URL` only when a built whiteboard page is hosted on a different origin than the API.

The redirect URI is the address the admin's browser uses to reach the API. `http://localhost:4000/...` works when the admin is on the same computer as the API. If the browser reaches the API by a LAN address, register that exact address instead and put the same value in the matching `*_REDIRECT_URI`.

After the client values are in `.env` and the API has been restarted, open the room in the admin portal and use Connect Google or Connect Microsoft. Sign in as the calendar owner. The panel then shows that account's meetings for the room's day, including the Meet or Teams join link. The API does not create or edit events.

### Panel display and themes

In the admin portal, **Display defaults** sets organization-wide panel behavior: theme (`Classic` or `Slate`), how often the panel refreshes meetings (10–600 seconds; each refresh reloads today's calendar from Google or Microsoft), and what **Now** and **Next** show (full details, `Booked by <organizer>`, or `Busy` only, plus optional meeting name, organizer, Meet/Teams label, and time). On each room, **Panel display** can override those defaults.

The current **Now** meeting can show a **Join** button on the card when enabled. **Next** meetings still open the join screen. Share receiver status lines stay in the developer console, not on the panel UI.

### Google

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable one API: **APIs & Services → Library → Google Calendar API → Enable**. No other Google API is required.
3. Open **Google Auth platform** (the older menu is **APIs & Services → OAuth consent screen**). Choose External, unless this is a Google Workspace app that should stay Internal. Under Branding, set an app name and a support email.
4. Under Data Access, add one scope: `https://www.googleapis.com/auth/calendar.readonly` (shown as "See and download any calendar you can access using your Calendar"). This is read-only. Do not add `calendar` or `calendar.events`, which allow writing.
5. While the app is in Testing, add the Google account you will connect as a test user under Audience. Publish the app only when accounts outside that list need to connect.
6. Under Clients (or **APIs & Services → Credentials → Create credentials → OAuth client ID**), create a **Web application**. Under **Authorized redirect URIs**, add `http://localhost:4000/api/oauth/google/callback` (or the LAN redirect you are using).
7. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The control API asks Google for offline access, so the connection keeps working after the first hour. On the Google consent screen, accept calendar read access.

### Microsoft

The control API signs in through `https://login.microsoftonline.com/common`, then reads the signed-in user's calendar from Microsoft Graph. Register the client so that endpoint is allowed.

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) → **Identity → Applications → App registrations → New registration**. The same page is under **App registrations** in the [Azure portal](https://portal.azure.com/).
2. Name the app, for example `Smart room`.
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**. A single-tenant registration will not work with the `common` endpoint this API uses.
4. Redirect URI: platform **Web**, value `http://localhost:4000/api/oauth/microsoft/callback` (or the LAN redirect you are using). Register, then confirm that URI under **Authentication**.
5. Open **Certificates & secrets → New client secret**. Copy the secret **Value** immediately. The secret ID is not the value. Put the application (client) ID in `MICROSOFT_CLIENT_ID` and the secret value in `MICROSOFT_CLIENT_SECRET`.
6. Open **API permissions → Add a permission → Microsoft Graph → Delegated permissions**. Add these three, and no application permissions:

| Permission | Why |
| --- | --- |
| `Calendars.Read` | Read the signed-in user's calendar events and the Teams join link. |
| `User.Read` | Read the account name shown on the room. Often already listed. |
| `offline_access` | Refresh the sign-in after the access token expires. |

7. If the tenant requires an administrator to approve Graph access, choose **Grant admin consent**. Personal Microsoft accounts can consent themselves on the Connect screen.

Do not add `Calendars.ReadWrite` or application permissions such as `Calendars.Read` with type Application. The panel reads one user's calendar. It does not read every mailbox in the tenant.

## Sideload the panel APK

The panel project is `apps/room`. Screen receiving runs in the system WebView, so it can be tried in Expo Go. The sideloaded APK is what you install on the room panel. Meet and Teams must still be installed on that device for Join.

From `apps/room/android`:

```powershell
.\gradlew.bat assembleRelease
```

That builds the release APK at `app\build\outputs\apk\release\app-release.apk`. With the panel connected and USB debugging on, install it with `adb install -r app\build\outputs\apk\release\app-release.apk`.

The `android` folder is generated from `apps/room` with `npx expo prebuild --platform android`. Run that again after changing the version in `app.json`, then run `.\gradlew.bat assembleRelease` again, or the APK keeps the previous version code.

On the panel:

1. Allow install from unknown sources if Android asks when the installer opens.
2. Install Google Meet (`com.google.android.apps.meetings`) and Microsoft Teams (`com.microsoft.teams`) on the same panel. Join opens those apps. If one is missing, the panel says so.
3. Open Smart Room, enter the Connect URL and the Connect token.

The same APK is used for every room. The token chooses the room. Room name, images, and meta come from the control API after that.

Later builds can install themselves. The first APK that contains this updater still has to be installed once by hand.

The panel does not send its version to the server. Each side keeps its own number, and the panel compares them.

The installed APK has two values from `apps/room/app.json`:

- **Version name** (`expo.version`) is the label shown in Settings. This build is `dev-1.0.5`.
- **Version code** (`android.versionCode`) is the integer Android stores as the build number. This build is `5`. `npx expo prebuild --platform android` writes both values into `apps/room/android` from `app.json`. Run prebuild again after changing them, then `.\gradlew.bat assembleRelease`, or the APK keeps the previous code.

The control server stores one published APK. In admin Settings, upload it with a version name, a version code, and optional notes. A connected panel requests that record. When the published version code is greater than the version code installed on the device, the panel offers an update. The version name is the label only.

Settings → Panel chooses what happens next:

- **Manual Check** waits until someone taps Check for update, then Install.
- **Prompt on launch** asks the next time the panel app opens.
- **Force** stays on the update screen until the installer starts.

Install downloads the APK from the control server and opens the Android package installer.

### Build dev-1.0.5

`apps/room/app.json` is set to version name `dev-1.0.5` and version code `5`. From `apps/room`, write that version into the native project, then build:

```powershell
npx expo prebuild --platform android
cd android
.\gradlew.bat assembleRelease
```

Install it on the connected panel:

```powershell
adb install -r app\build\outputs\apk\release\app-release.apk
```

In admin Settings, publish `apps/room/android/app/build/outputs/apk/release/app-release.apk` with:

- Version name: `dev-1.0.5`
- Version code: `5`

The version code in the form must match `android.versionCode` in the APK, and it must be higher than the code already published. If the form rejects `5`, raise `android.versionCode` in `apps/room/app.json` above the published code, run prebuild and `.\gradlew.bat assembleRelease` again, and publish that same number.

On a panel still on version code 1, open Settings → Panel and use Check for update, or reopen the app when the update method is Prompt on launch or Force.

The hold button and the "you are sharing" view are in `apps/share-web`. The panel's stop-and-return behavior is in this APK. Deploy the share site and the control API with the panel build.

The APK is a fullscreen landscape app without device-owner setup. A locked kiosk that returns Home to this screen, while still allowing Meet and Teams, depends on the panel image and is not configured by the APK.

## Screen share

Room code sharing is received by the APK. The laptop opens the page in the QR code and shares its screen. That page is `apps/share-web`, and the link is the share origin plus the room code, such as `http://localhost:5174/ABC123`. A `?code=` link still works. Set `SHARE_WEB_ORIGIN` to an address the laptop can open. The share site reads its control API from `API_URL` in `apps/share-web/.env` and forwards `/api` and `/ws` there. Set `VITE_API_URL` only when a built share site is hosted on a different origin than the API.

The laptop and the panel try a direct video path on their own. A connection on the same network stays between the two devices. If that check fails, TURN (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`) carries the video when those values are set. JPEG frames still go through the control server until the video is actually showing, and they stay on that path when neither a direct connection nor TURN is available.

The same room code works from the Windows share app in `apps/share-desktop`. The panel does not change: the QR code still opens this page, and the picture settings on the panel still apply. On the sending PC, install the desktop dependencies once, then run:

```powershell
npm install --prefix apps/share-desktop
npm run dev:share-desktop
```

The first compile needs [Rust](https://rustup.rs/) and **Visual Studio Build Tools** with the **Desktop development with C++** workload and a **Windows 10/11 SDK**. The repo root script loads MSVC for you; if linking still fails, install that SDK in the Visual Studio Installer.

`dev:share-desktop` opens a **native Windows window** (Tauri), not the browser tab on port 5176. To ship an installer:

```powershell
npm run build:share-desktop
```

The `.exe` / NSIS installer is under `apps/share-desktop/src-tauri/target/release/bundle/`.

Enter the control server address, such as `http://localhost:4000`, and the code shown on the panel. The address is remembered on that PC. The app then asks which display or window to share, and the panel treats it like a browser share.

Google Cast, Miracast, and AirPlay are slots in the share screen. They stay unavailable until a licensed or system receiver is linked. Miracast needs system-signed Wi-Fi Display access, which a normal APK does not have. The panel's own share app can be opened with the OEM package name configured on the room.

## Whiteboard

Connect to Screen on the panel stays on the room until someone shares, opens the whiteboard, or joins a meeting. That first action opens one room session in the background. The session can cover several meetings and keeps its whiteboard. End session on the panel closes it. The next activity starts a new one.

The whiteboard icon on the room opens the board full screen. The same board opens in a browser at `WHITEBOARD_WEB_ORIGIN` with the code, for example `http://10.224.0.237:5175/ABC12345`. That origin has to be an address the panel can open. An emulator cannot use `localhost`.

## Local development

No domain is required. `docker compose up` on this computer reads [docker-compose.override.yml](docker-compose.override.yml), which Coolify does not use. The API runs `npm run dev:docker` and the web apps run their Vite dev servers, with the source mounted in. Saving a file reloads that service. `npm start` and the built nginx site stay the production path.

```powershell
docker compose up --build
```

| URL | Service |
| --- | --- |
| http://localhost:5174 | Share page |
| http://localhost:5174/AB12CD | Screen share. The code is 6 characters |
| http://localhost:5175/AB12CD34 | Whiteboard. The code is 8 characters |
| http://localhost:5173 | Admin |
| http://localhost:4000/api/... | Control API |

[deploy/localhost.env.example](deploy/localhost.env.example) keeps admin, the share page, and the OAuth callbacks on `localhost`. The share page has to stay there, or on https, because a browser will not capture the screen from an address like `http://192.168.1.15`. [deploy/.env](deploy/.env.example) sets `PUBLIC_API_URL` and `WHITEBOARD_WEB_ORIGIN` to this PC's Wi-Fi address, `http://192.168.1.15:4000` and `http://192.168.1.15:5175`, so an emulator can reach those ports. `localhost` inside the emulator is the emulator itself. If that Wi-Fi address does not answer from the emulator, use `10.0.2.2` with the same ports. OAuth secrets can live in the same `deploy/.env`.

Saving a file under `services/api/src` or a web app reloads that service. The containers stay up. Run `docker compose up --build` again after a dependency change, or after editing `deploy/.env`. The web apps keep their installed packages in Docker volumes; if an install looks stale, remove `admin-modules`, `share-modules`, and `board-modules`.

The single-port nginx site is still available with `docker compose --profile bundled up --build`. That build does not reload on save. It listens on http://localhost and https://localhost with the image's localhost certificate.

## One domain

Nginx is the only published service. The API, admin, share page, and whiteboard stay on the Docker network.

Coolify runs `docker-compose.yml` alone, and its proxy already owns host ports 80 and 443, so the nginx service only exposes port 80 on the Compose network. In Coolify, assign the public domain to the **nginx** service and set the container port to **80**. Leave **api** without a domain. Coolify terminates TLS; the image's placeholder certificate is only for a local bundled run.

| URL | Service |
| --- | --- |
| `https://connect.example.com/` | Share page |
| `https://connect.example.com/AB12CD` | Screen share. The code is 6 characters |
| `https://connect.example.com/AB12CD34` | Whiteboard. The code is 8 characters |
| `https://connect.example.com/admin` | Admin |
| `https://connect.example.com/download` | Panel APK download. Needs the code from admin Display defaults → Download page |
| `https://connect.example.com/api/...` | Control API |
| `https://connect.example.com/media/...` | Room images |
| `https://connect.example.com/ws` | Share socket |
| `https://connect.example.com/ws/whiteboard` | Whiteboard socket |

Set `PUBLIC_API_URL`, `SHARE_WEB_ORIGIN`, and `WHITEBOARD_WEB_ORIGIN` to that domain. Set `ADMIN_ORIGIN` to the same domain plus `/admin`, because that is where the admin app is mounted. OAuth callbacks are `https://connect.example.com/api/oauth/google/callback` and the Microsoft equivalent. The image includes a placeholder TLS certificate. Mount real files at `/etc/nginx/certs/fullchain.pem` and `/etc/nginx/certs/privkey.pem` before pointing a public name at it. The panel control URL is the domain with no `/api` suffix.
