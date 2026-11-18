/* Solo Tales Entrypoint.
   Wires the pure headless engine, multi-key LLM/image routers, platform storage, and decoupled UI shell. */

import "./ui/styles.css";
import { ImageRouter } from "./adapters/image/image-router";
import { ModelRouter } from "./adapters/llm";
import { KeyringManager, createPlatformGameStore } from "./adapters/storage";
import { PortraitUrlCache } from "./ui/dom";
import { createGameShell } from "./ui/game-shell";
import { syncRoutersFromKeyring } from "./ui/settings-modal";
import { applyTheme, getActiveThemeId } from "./ui/themes/registry";

async function bootstrap(): Promise<void> {
  applyTheme(getActiveThemeId());
  const root = document.getElementById("app") || document.body;

  const store = await createPlatformGameStore();
  const keyring = new KeyringManager(store);
  await keyring.load();

  const router = new ModelRouter({
    resolveApiKey: keyring.resolveApiKey
  });

  const imageRouter = new ImageRouter({
    getConnections: () => router.getConnections(),
    resolveApiKey: keyring.resolveApiKey
  });

  syncRoutersFromKeyring(keyring, router, imageRouter);

  const portraits = new PortraitUrlCache();

  const shell = createGameShell({
    root,
    store,
    keyring,
    router,
    imageRouter,
    portraits
  });

  await shell.showStart();
}

bootstrap().catch(err => {
  console.error("Failed to initialize Solo Tales:", err);
  const root = document.getElementById("app") || document.body;
  root.textContent = "Failed to start Solo Tales. Check the developer console for details.";
});
