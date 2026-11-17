import { startApp } from './app.js';

// Entry point (loaded by index.html as a module, so it runs after the page is parsed).
startApp().catch((err) => console.error(err));
