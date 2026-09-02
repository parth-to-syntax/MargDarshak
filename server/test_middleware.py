from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"])

@app.middleware("http")
async def auth(request, call_next):
    # return JSONResponse(status_code=401, content={"error": "no"})
    raise HTTPException(status_code=401, detail="no")

@app.get("/")
def read_root():
    return {"ok": True}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001)
