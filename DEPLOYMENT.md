# Deployment Guide

## Deploy the Server (Backend)

### Option 1: Render (Recommended)

1. **Create a Render account** at https://render.com
2. **Create a new Web Service**:
   - Connect your GitHub repository
   - Select "spotify-guessing-game"
   - Root Directory: `server`
   - Build Command: `npm install`
   - Start Command: `node index.js`
3. **Add Environment Variables**:
   - `PORT`: `3001` (or leave blank, Render auto-assigns)
   - `CLIENT_URL`: Your GitHub Pages URL (add after client deployment)
4. **Deploy** and copy your server URL (e.g., `https://jumble-server.onrender.com`)

### Option 2: Railway

1. **Create a Railway account** at https://railway.app
2. **New Project** → Deploy from GitHub repo
3. Select `server` directory
4. Railway will auto-detect Node.js and deploy
5. Copy your server URL

## Deploy the Client (Frontend)

### Option 1: GitHub Pages (Already Configured)

1. **Update the server URL** in `.env.production` file:
   ```
   VITE_SERVER_URL=https://your-render-server.onrender.com
   VITE_CLIENT_URL=https://yourusername.github.io/Jumble/#/play
   ```

2. **Enable GitHub Pages**:
   - Go to repository Settings → Pages
   - Source: GitHub Actions
   - Push to main branch to trigger deployment

3. **Access your game** at:
   `https://yourusername.github.io/Jumble/`

### Option 2: Netlify

1. **Install Netlify CLI**: `npm install -g netlify-cli`
2. **Build the client**:
   ```bash
   cd client
   npm run build
   ```
3. **Deploy**:
   ```bash
   netlify deploy --dir=dist --prod
   ```
4. Follow prompts to create new site

## Quick Deploy Steps

1. **Deploy Server First**:
   - Push code to GitHub
   - Connect to Render/Railway
   - Get server URL

2. **Update Client Config**:
   - Create `client/.env.production` with server URL
   - Push to GitHub

3. **Deploy Client**:
   - GitHub Pages deploys automatically on push
   - Or use Netlify CLI

## Environment Variables

### Server (.env):
```
PORT=3001
CLIENT_URL=https://yourusername.github.io/Jumble/
```

### Client (.env.production):
```
VITE_SERVER_URL=https://your-server.onrender.com
VITE_CLIENT_URL=yourusername.github.io/Jumble/#/play
```

## Troubleshooting

- **CORS errors**: Make sure `CLIENT_URL` is set correctly in server .env
- **Socket.io connection failed**: Check that server URL is correct in client
- **GitHub Pages 404**: Make sure base path is `/Jumble/` in vite.config.js
