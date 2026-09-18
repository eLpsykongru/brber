import { registerRootComponent } from 'expo';

// before App: it sets the language and the direction every screen loads into
import './src/lib/language';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
