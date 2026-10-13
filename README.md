# Smart room

Two layers. The control pane creates rooms, images, and calendar connections. The Android panel fetches that room and joins meetings on the device.

## Run the control pane

```powershell
npm install --prefix services/api
npm install --prefix apps/admin
npm install --prefix apps/share-web
copy services\api\.env.example services\api\.env
npm run dev:api
npm run dev:admin
npm run dev:share
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
| `ADMIN_PASSWORD` | Admin sign-in password. |
| `GOOGLE_CLIENT_ID` | OAuth client ID from Google Cloud. |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret from Google Cloud. |
| `GOOGLE_REDIRECT_URI` | Must match the redirect URI registered on that client. Default `http://localhost:4000/api/oauth/google/callback`. |
| `MICROSOFT_CLIENT_ID` | Application (client) ID from the Entra app registration. |
| `MICROSOFT_CLIENT_SECRET` | Client secret value from that registration. |
| `MICROSOFT_REDIRECT_URI` | Must match the redirect URI on that registration. Default `http://localhost:4000/api/oauth/microsoft/callback`. |

The share site has its own file, `apps/share-web/.env`. Set `API_URL` to the control API, for example `http://localhost:4000`. Set `VITE_API_URL` only when a built share site is hosted on a different origin than the API.

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

From `apps/room`, with an [Expo account](https://expo.dev) signed in:

```powershell
npm install
npx eas build -p android --profile preview
```

`eas.json` builds an APK (`buildType: apk`), not a Play Store bundle.

On the panel:

1. Allow install from unknown sources.
2. Copy the APK over USB or download it, then install it. From a computer: `adb install path\to\app.apk`.
3. Install Google Meet (`com.google.android.apps.meetings`) and Microsoft Teams (`com.microsoft.teams`) on the same panel. Join opens those apps. If one is missing, the panel says so.
4. Open Smart Room, enter the control server address and the Connect token.

The same APK is used for every room. The token chooses the room. Room name, images, and meta come from the control API after that.

The APK is a fullscreen landscape app without device-owner setup. A locked kiosk that returns Home to this screen, while still allowing Meet and Teams, depends on the panel image and is not configured by the APK.

## Screen share

Room code sharing is received by the APK. The laptop opens the page in the QR code and shares its screen. That page is `apps/share-web`, and the link is only that page plus the room code, such as `http://localhost:5174/?code=ABC123`. Set `SHARE_WEB_ORIGIN` to an address the laptop can open. The share site reads its control API from `API_URL` in `apps/share-web/.env` and forwards `/api` and `/ws` there. Set `VITE_API_URL` only when a built share site is hosted on a different origin than the API.

TURN (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`) is required when the laptop is not on the same network as the panel. Without TURN, sharing works on one LAN.

Google Cast, Miracast, and AirPlay are slots in the share screen. They stay unavailable until a licensed or system receiver is linked. Miracast needs system-signed Wi-Fi Display access, which a normal APK does not have. The panel's own share app can be opened with the OEM package name configured on the room.
