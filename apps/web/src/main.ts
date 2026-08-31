import { createPinia } from 'pinia';
import { createApp } from 'vue';
import 'element-plus/dist/index.css';
import 'katex/dist/katex.min.css';

import App from './App.vue';
import { initializeTheme } from './composables/useTheme';
import { router } from './router';
import './styles/tokens.css';
import './styles/breakpoints.scss';
import './styles/main.css';
import './styles/element.css';

initializeTheme();
createApp(App).use(createPinia()).use(router).mount('#app');
