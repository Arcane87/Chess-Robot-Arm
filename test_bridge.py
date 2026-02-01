#!/usr/bin/env python3
import asyncio
import websockets
import json
import time

async def test_bridge():
    print("Testing WebSocket bridge...")
    
    async with websockets.connect('ws://localhost:8080') as websocket:
        print("✅ Connected to bridge")
        
        # Send test message
        await websocket.send(json.dumps({"type": "test"}))
        print("📤 Sent test message")
        
        # Wait for response
        response = await websocket.recv()
        print(f"📥 Received: {response}")
        
        # Send connect command
        print("Connecting to robot system...")
        await websocket.send(json.dumps({"type": "connect"}))
        
        # Get response
        response = await websocket.recv()
        print(f"Robot connection: {response}")
        
        # Test gripper
        data = json.loads(response)
        if data.get("type") == "connected":
            print("Testing gripper open...")
            await websocket.send(json.dumps({"type": "gripper", "action": "open"}))
            
            response = await websocket.recv()
            print(f"Gripper response: {response}")

if __name__ == "__main__":
    asyncio.run(test_bridge())