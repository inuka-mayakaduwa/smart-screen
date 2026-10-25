import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
import { DevPreview } from "./src/layouts/deepSpace/DevPreview";

// EXPO_PUBLIC_PREVIEW=1 npx expo start renders the waiting screen with a state switcher instead of the panel.
registerRootComponent(process.env.EXPO_PUBLIC_PREVIEW === "1" ? DevPreview : App);
