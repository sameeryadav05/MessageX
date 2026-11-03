import express from 'express'
import type {Server} from "node:http"

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));

app.get('/health',(_req,res)=>{
  res.status(200).json({
    success: true,
    service: "MessageX Management API",
    status: "healthy",
    timestamp: new Date().toISOString()
  });
})

export function startHttpServer(port: number): Server {
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`[HTTP Server] Management API listening on http://127.0.0.1:${port}`);
  });

  server.on("error", (error) => {
    console.error("[HTTP] Server error:", error);
  });

  return server;
}