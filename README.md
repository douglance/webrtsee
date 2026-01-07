# WebRTSee

Grass ground + blue sky 3D scene with an open office interior. Multiplayer uses WebRTC for video avatars and WebSocket signaling.

## Local Run (Node)

1. `npm install`
2. `npm start`
3. Open `http://localhost:3000` in two browser tabs or different devices on the same network.

## Local Run (Cloudflare Workers Dev)

1. `npm install`
2. `npm run dev`
3. Open the URL shown by Wrangler (default `http://localhost:8787`).

## Deploy (Cloudflare Workers)

1. `npm install`
2. `npx wrangler login`
3. `npm run deploy`

This deploys the Worker, static assets, and the Durable Object used for rooms. The static `public/` folder is bundled as Worker assets, so no separate Pages step is required.

## Notes

- Each browser tab joins a room and shares a webcam feed as the avatar.
- A random lobby code is generated on load. Use the Copy Link/Copy Code buttons to share.
- Click the scene to lock the cursor and use WASD to move.
- Use the Share Screen button to broadcast your display, then Move Screen to drag it around.
