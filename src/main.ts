import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router';

import { IonicVue } from '@ionic/vue';

/* Core CSS required for Ionic components to work properly */
import '@ionic/vue/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';

/**
 * Ionic Dark Mode
 * -----------------------------------------------------
 * For more info, please see:
 * https://ionicframework.com/docs/theming/dark-mode
 */

/* @import '@ionic/vue/css/palettes/dark.always.css'; */
/* @import '@ionic/vue/css/palettes/dark.class.css'; */
import '@ionic/vue/css/palettes/dark.system.css';

/* Theme variables */
import './theme/variables.css';
import './theme/sheets.css';
import './theme/buttons.css';
import './theme/picker.css';

const app = createApp(App)
  // swipeBackEnabled: false — the iOS edge-swipe-back gesture and the Ambience range
  // (and, before it, tempo/subdivision ranges) sit close enough to the screen edge that
  // a drag starting there was sometimes recognized as a navigation swipe instead, sliding
  // SessionView aside and triggering the "start fresh?" leave-session guard. Eddy has no
  // route that back-navigation via gesture would meaningfully serve anyway (Home is the
  // only other screen, and going back to it is always an explicit, guarded action) — so
  // rather than fight the gesture recognizer per-control, disable it app-wide.
  .use(IonicVue, { swipeBackEnabled: false })
  .use(createPinia())
  .use(router);

router.isReady().then(() => {
  app.mount('#app');
});
