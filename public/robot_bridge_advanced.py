#!/usr/bin/env python3
"""
Advanced WebSocket bridge with proper OnRobot 2FG7 gripper control
Now with adjustable width settings and proper protocol compliance
"""
import asyncio
import websockets
import socket
import json
import time
import struct
import threading
from typing import Optional, Dict, Any, Tuple

# ===================================================================
# OnRobot 2FG7 Gripper Controller (Modbus TCP) - UPDATED
# ===================================================================
class OnRobotGripper:
    """Direct TCP Modbus communication for OnRobot 2FG7/2FG14 gripper"""
    
    def __init__(self, ip="192.168.1.1", port=502, unit_id=65):
        self.ip = ip
        self.port = port
        self.unit_id = unit_id
        self.sock = None
        self.transaction_id = 1
        self.lock = threading.Lock()
        self.connected = False
        self.product_code = None
        self.model_type = None
        self.model_limits = None  # Will store (min_width_mm, max_width_mm)
        self.is_2fg7 = False
        self.is_2fg14 = False
        
    def connect(self) -> bool:
        """Establish connection to Compute Box"""
        print(f"[GRIPPER] Connecting to {self.ip}:{self.port}...")
        
        try:
            with self.lock:
                if self.sock:
                    self.sock.close()
                
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.sock.settimeout(3.0)
                self.sock.connect((self.ip, self.port))
                self.connected = True
                
                # Read product code to identify the gripper
                self.product_code = self._read_holding_register(1536)
                if self.product_code:
                    print(f"[GRIPPER] ✓ Connected! Product code: 0x{self.product_code:04X}")
                    
                    # Set model information based on product code
                    if self.product_code == 0xC0:  # 2FG7
                        self.model_type = "2FG7"
                        self.is_2fg7 = True
                        print(f"[GRIPPER] Type: 2FG7 (13-31mm)")
                    elif self.product_code == 0xC1:  # 2FG14
                        self.model_type = "2FG14"
                        self.is_2fg14 = True
                        print(f"[GRIPPER] Type: 2FG14 (22-48mm)")
                    elif self.product_code == 0xF0:  # 2FGP20
                        self.model_type = "2FGP20"
                        print(f"[GRIPPER] Type: 2FGP20")
                    else:
                        self.model_type = "Unknown"
                        print(f"[GRIPPER] Type: Unknown (0x{self.product_code:04X})")
                    
                    # Read actual hardware limits from the gripper
                    min_width_units = self._read_holding_register(259)  # Min external width
                    max_width_units = self._read_holding_register(260)  # Max external width
                    
                    if min_width_units is not None and max_width_units is not None:
                        min_width_mm = min_width_units / 10.0
                        max_width_mm = max_width_units / 10.0
                        self.model_limits = (min_width_mm, max_width_mm)
                        print(f"[GRIPPER] Actual limits: {min_width_mm}mm to {max_width_mm}mm")
                    else:
                        # Fallback to nominal limits based on model
                        if self.is_2fg7:
                            self.model_limits = (13.0, 31.0)
                        elif self.is_2fg14:
                            self.model_limits = (22.0, 48.0)
                        else:
                            self.model_limits = (0.0, 100.0)
                        print(f"[GRIPPER] Using nominal limits: {self.model_limits[0]}mm to {self.model_limits[1]}mm")
                        
                else:
                    print(f"[GRIPPER] ✓ Connected but could not read product code")
                
                return True
                
        except Exception as e:
            print(f"[GRIPPER] ✗ Connection failed: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Close connection"""
        with self.lock:
            if self.sock:
                self.sock.close()
                self.sock = None
            self.connected = False
            print("[GRIPPER] Disconnected")
    
    def _send_modbus_request(self, function_code: int, data: bytes) -> Optional[bytes]:
        """Send raw Modbus TCP request and get response"""
        if not self.connected or not self.sock:
            return None
            
        try:
            # Increment transaction ID
            transaction_id = self.transaction_id
            self.transaction_id = (self.transaction_id + 1) % 65536
            
            # Build MBAP header (Modbus Application Protocol)
            length = len(data) + 1  # +1 for unit_id
            mbap_header = struct.pack('>HHHB', 
                                     transaction_id, 
                                     0,           # Protocol ID = 0 for Modbus
                                     length, 
                                     self.unit_id)
            
            # Build complete frame
            frame = mbap_header + data
            
            # Send request
            self.sock.sendall(frame)
            
            # Receive response header (7 bytes)
            header = self.sock.recv(7)
            if len(header) != 7:
                print(f"[GRIPPER] Invalid header length: {len(header)}")
                return None
            
            # Parse response header
            resp_trans_id, resp_proto_id, resp_length, resp_unit_id = struct.unpack('>HHHB', header)
            
            # Receive remaining data
            data_len = resp_length - 1  # Subtract unit_id byte
            if data_len > 0:
                response_data = self.sock.recv(data_len)
                if len(response_data) != data_len:
                    print(f"[GRIPPER] Incomplete data: got {len(response_data)}, expected {data_len}")
                    return None
            else:
                response_data = b''
            
            # Check if it's an exception response
            if response_data and response_data[0] == function_code + 0x80:
                exception_code = response_data[1]
                print(f"[GRIPPER] Modbus exception: code {exception_code}")
                return None
            
            return response_data
            
        except socket.timeout:
            print("[GRIPPER] Timeout sending/receiving data")
            return None
        except Exception as e:
            print(f"[GRIPPER] Communication error: {e}")
            return None
    
    def _read_holding_register(self, address: int) -> Optional[int]:
        """Read a single holding register (Function Code 0x03)"""
        pdu = struct.pack('>BHH', 0x03, address, 1)
        response = self._send_modbus_request(0x03, pdu)
        
        if response and len(response) >= 3:
            if response[0] == 0x03 and response[1] == 2:
                return struct.unpack('>H', response[2:4])[0]
        
        return None
    
    def _write_single_register(self, address: int, value: int) -> bool:
        """Write a single register (Function Code 0x06)"""
        pdu = struct.pack('>BHH', 0x06, address, value)
        response = self._send_modbus_request(0x06, pdu)
        
        if response and len(response) >= 5:
            return response[0] == 0x06
        
        return False
    
    def get_status(self) -> Dict[str, Any]:
        """Get comprehensive gripper status"""
        if not self.connected:
            return {"connected": False, "error": "Not connected"}
        
        # Read various status registers
        status_reg = self._read_holding_register(256)  # 0x0100 Status
        width_reg = self._read_holding_register(257)   # 0x0101 External width
        internal_width_reg = self._read_holding_register(258)  # 0x0102 Internal width
        min_reg = self._read_holding_register(259)     # 0x0103 Min external width
        max_reg = self._read_holding_register(260)     # 0x0104 Max external width
        min_internal_reg = self._read_holding_register(261)  # 0x0105 Min internal width
        max_internal_reg = self._read_holding_register(262)  # 0x0106 Max internal width
        force_reg = self._read_holding_register(263)   # 0x0107 Current force
        max_force_reg = self._read_holding_register(1029)  # 0x0405 Maximum force
        
        result = {
            "connected": self.connected,
            "product_code": self.product_code,
            "model_type": self.model_type,
            "width_mm": width_reg / 10.0 if width_reg is not None else None,
            "internal_width_mm": internal_width_reg / 10.0 if internal_width_reg is not None else None,
            "min_width_mm": min_reg / 10.0 if min_reg is not None else None,
            "max_width_mm": max_reg / 10.0 if max_reg is not None else None,
            "min_internal_width_mm": min_internal_reg / 10.0 if min_internal_reg is not None else None,
            "max_internal_width_mm": max_internal_reg / 10.0 if max_internal_reg is not None else None,
            "force_n": force_reg if force_reg is not None else None,
            "max_force_n": max_force_reg if max_force_reg is not None else None,
            "model_limits": self.model_limits,
        }
        
        # Decode status register bits
        if status_reg is not None:
            result.update({
                "busy": bool(status_reg & 0x0001),
                "grip_detected": bool(status_reg & 0x0002),
                "error_not_calibrated": bool(status_reg & 0x0008),
                "error_linear_sensor": bool(status_reg & 0x0010),
                "raw_status": status_reg,
            })
        
        return result
    
    def move_to_width(self, width_mm: float, force_n: int = 20, speed_percent: int = 50) -> bool:
        """Move gripper to a specific width (main function for both open/close)"""
        if not self.connected:
            print("[GRIPPER] Not connected")
            return False
        
        # Clamp speed to valid range (10-100%)
        speed_percent = max(10, min(100, speed_percent))
        
        # Convert width to gripper units (1/10 mm)
        target_width_units = int(width_mm * 10)
        
        print(f"[GRIPPER] Moving to {width_mm}mm ({target_width_units} units)...")
        
        # Check against hardware limits if available
        if self.model_limits:
            min_limit, max_limit = self.model_limits
            if width_mm < min_limit:
                print(f"[GRIPPER] Warning: {width_mm}mm below minimum {min_limit}mm, clamping to {min_limit}mm")
                width_mm = min_limit
                target_width_units = int(width_mm * 10)
            elif width_mm > max_limit:
                print(f"[GRIPPER] Warning: {width_mm}mm above maximum {max_limit}mm, clamping to {max_limit}mm")
                width_mm = max_limit
                target_width_units = int(width_mm * 10)
        
        # Set parameters according to protocol
        # Address 0x0000: Target width (in 1/10 mm units)
        if not self._write_single_register(0, target_width_units):
            print("[GRIPPER] Failed to set target width")
            return False
        
        # Address 0x0001: Target force (in N)
        if not self._write_single_register(1, force_n):
            print("[GRIPPER] Failed to set target force")
            return False
        
        # Address 0x0002: Target speed (in %, clamped to 10-100%)
        if not self._write_single_register(2, speed_percent):
            print("[GRIPPER] Failed to set target speed")
            return False
        
        # Address 0x0003: Command (1 = Grip external)
        if not self._write_single_register(3, 1):
            print("[GRIPPER] Failed to execute grip command")
            return False
        
        print(f"[GRIPPER] ✓ Command sent: width={width_mm}mm, force={force_n}N, speed={speed_percent}%")
        return True
    
    def open(self, width_mm: Optional[float] = None, force_n: int = 20, speed_percent: int = 50) -> bool:
        """Open gripper to specified width"""
        if not self.connected:
            print("[GRIPPER] Not connected")
            return False
        
        # If no width specified, use default of 20mm
        if width_mm is None:
            width_mm = 20.0
        
        # Clamp speed
        speed_percent = max(10, min(100, speed_percent))
        
        print(f"[GRIPPER] Opening to {width_mm}mm...")
        return self.move_to_width(width_mm, force_n, speed_percent)
    
    def close(self, width_mm: Optional[float] = None, force_n: int = 20, speed_percent: int = 50) -> bool:
        """Close gripper to specified width"""
        if not self.connected:
            print("[GRIPPER] Not connected")
            return False
        
        # If no width specified, use default of 0.3mm
        if width_mm is None:
            width_mm = 0.3
        
        # Clamp speed
        speed_percent = max(10, min(100, speed_percent))
        
        print(f"[GRIPPER] Closing to {width_mm}mm...")
        return self.move_to_width(width_mm, force_n, speed_percent)
    
    def stop(self) -> bool:
        """Stop gripper movement"""
        if not self.connected:
            return False
        
        print("[GRIPPER] Stopping gripper...")
        # Address 0x0003: Command (3 = Stop)
        result = self._write_single_register(3, 3)
        if result:
            print("[GRIPPER] ✓ Stopped")
        return result
    
    def set_finger_length(self, length_mm: float) -> bool:
        """Set finger length in 1/10 mm (Address 0x0400)"""
        if not self.connected:
            return False
        
        length_units = int(length_mm * 10)
        print(f"[GRIPPER] Setting finger length to {length_mm}mm ({length_units} units)...")
        return self._write_single_register(1024, length_units)
    
    def set_finger_height(self, height_mm: float) -> bool:
        """Set finger height in 1/10 mm (Address 0x0401)"""
        if not self.connected:
            return False
        
        height_units = int(height_mm * 10)
        print(f"[GRIPPER] Setting finger height to {height_mm}mm ({height_units} units)...")
        return self._write_single_register(1025, height_units)
    
    def set_finger_orientation(self, orientation: int) -> bool:
        """Set finger orientation (0 = inward, 1 = outward) (Address 0x0402)"""
        if not self.connected:
            return False
        
        if orientation not in [0, 1]:
            print(f"[GRIPPER] Invalid orientation: {orientation} (must be 0 or 1)")
            return False
        
        print(f"[GRIPPER] Setting finger orientation to {orientation}...")
        return self._write_single_register(1026, orientation)
    
    def set_fingertip_offset(self, offset_mm: float) -> bool:
        """Set fingertip offset in 1/100 mm (Address 0x0403)"""
        if not self.connected:
            return False
        
        offset_units = int(offset_mm * 100)
        print(f"[GRIPPER] Setting fingertip offset to {offset_mm}mm ({offset_units} units)...")
        return self._write_single_register(1027, offset_units)


# ===================================================================
# UR3e Robot Arm Controller (UNCHANGED)
# ===================================================================
class URRobotArm:
    """Controller for UR3e robot arm"""
    
    # Movement parameters from original bridge
    ACCELERATION = 0.3
    VELOCITY = 0.15
    MOVE_WAIT_TIME = 3.5      # seconds for clearance moves
    VERTICAL_WAIT_TIME = 1.0  # seconds for vertical moves
    RESTING_WAIT_TIME = 4.0   # seconds for resting position moves
    
    def __init__(self, ip="192.168.1.20", port=30002):
        self.ip = ip
        self.port = port
        self.socket = None
        self.connected = False
        
    def connect(self) -> bool:
        """Connect to UR3e robot"""
        print(f"[UR3e] Connecting to {self.ip}:{self.port}...")
        
        try:
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.settimeout(10)
            self.socket.connect((self.ip, self.port))
            self.connected = True
            
            # Test connection
            self._send_command("textmsg(\"WebSocket Bridge Connected\")")
            print(f"[UR3e] ✓ Connected to UR3e at {self.ip}:{self.port}")
            return True
            
        except Exception as e:
            print(f"[UR3e] ✗ Connection failed: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Disconnect from robot"""
        if self.socket:
            self.socket.close()
            self.socket = None
        self.connected = False
        print("[UR3e] Disconnected")
    
    def _send_command(self, command: str, wait_time: float = 0.1) -> bool:
        """Send command to UR3e"""
        if not self.connected or not self.socket:
            print("[UR3e] Not connected")
            return False
        
        try:
            full_cmd = command + "\n"
            self.socket.sendall(full_cmd.encode())
            time.sleep(wait_time)
            return True
        except Exception as e:
            print(f"[UR3e] Command failed: {e}")
            self.connected = False
            return False
    
    def move_to_pose(self, pose: Dict[str, float], move_type: str = "clearance") -> bool:
        """Move to a specific pose"""
        if not self.connected:
            return False
        
        # Determine wait time based on move type
        if move_type == "vertical":
            wait_time = self.VERTICAL_WAIT_TIME
            # Use movel for vertical moves (linear, precise)
            cmd = (f"movel(p[{pose['x']:.5f}, {pose['y']:.5f}, {pose['z']:.5f}, "
                   f"{pose['rx']:.5f}, {pose['ry']:.5f}, {pose['rz']:.5f}], "
                   f"a={self.ACCELERATION}, v={self.VELOCITY})")
        else:
            wait_time = self.MOVE_WAIT_TIME if move_type == "clearance" else self.RESTING_WAIT_TIME
            # Use movej for clearance/resting moves (fast, joint space)
            cmd = (f"movej(p[{pose['x']:.5f}, {pose['y']:.5f}, {pose['z']:.5f}, "
                   f"{pose['rx']:.5f}, {pose['ry']:.5f}, {pose['rz']:.5f}], "
                   f"a={self.ACCELERATION}, v={self.VELOCITY})")
        
        # Send command
        if not self._send_command(cmd):
            return False
        
        # Wait for move to complete
        print(f"[UR3e] ⏱️  Waiting {wait_time:.1f}s for {move_type} move...")
        time.sleep(wait_time)
        
        print(f"[UR3e] ✓ Move completed: {move_type}")
        return True
    
    def get_status(self) -> Dict[str, Any]:
        """Get robot arm status"""
        return {
            "connected": self.connected,
            "ip": self.ip,
            "port": self.port
        }


# ===================================================================
# Combined Robot System Controller (UPDATED for width control)
# ===================================================================
class RobotSystem:
    """Combines UR3e arm and OnRobot gripper with enhanced width control"""
    
    def __init__(self):
        self.arm = URRobotArm()
        self.gripper = OnRobotGripper()
        self.connected = False
        self.last_open_width = None
        self.last_close_width = None
        
    def connect(self) -> bool:
        """Connect to both arm and gripper"""
        print("=" * 60)
        print("🤖 ROBOT SYSTEM STARTUP")
        print("=" * 60)
        
        # Connect to gripper first
        print("\n1. Connecting to OnRobot 2FG7 Gripper...")
        gripper_ok = self.gripper.connect()
        
        if not gripper_ok:
            print("[SYSTEM] ❌ Gripper connection failed - check power, IP (192.168.1.1), and network")
            return False
        
        # Connect to arm
        print("\n2. Connecting to UR3e Robot Arm...")
        arm_ok = self.arm.connect()
        
        if not arm_ok:
            print("[SYSTEM] ❌ Arm connection failed - check power, IP (192.168.1.20), and network")
            return False
        
        self.connected = True
        print("\n" + "=" * 60)
        print("✅ SYSTEM READY: Both arm and gripper connected!")
        print("=" * 60)
        return True
    
    def disconnect(self):
        """Disconnect from both devices"""
        print("[SYSTEM] Disconnecting...")
        self.arm.disconnect()
        self.gripper.disconnect()
        self.connected = False
        print("[SYSTEM] Disconnected")
    
    def execute_move(self, pose: Dict[str, float], move_type: str = "clearance") -> bool:
        """Execute a robot move"""
        if not self.connected:
            return False
        return self.arm.move_to_pose(pose, move_type)
    
    def execute_gripper(self, action: str, width_mm: Optional[float] = None, 
                       force_n: int = 20, speed_percent: int = 50) -> bool:
        """Execute gripper action with optional width specification"""
        if not self.connected:
            return False
        
        if action == "open":
            success = self.gripper.open(width_mm, force_n, speed_percent)
            if success and width_mm is not None:
                self.last_open_width = width_mm
            return success
        elif action == "close":
            success = self.gripper.close(width_mm, force_n, speed_percent)
            if success and width_mm is not None:
                self.last_close_width = width_mm
            return success
        elif action == "stop":
            return self.gripper.stop()
        elif action == "move_to_width":
            if width_mm is None:
                print("[SYSTEM] Error: Width must be specified for move_to_width action")
                return False
            return self.gripper.move_to_width(width_mm, force_n, speed_percent)
        else:
            print(f"[SYSTEM] Unknown gripper action: {action}")
            return False
    
    def get_status(self) -> Dict[str, Any]:
        """Get complete system status"""
        gripper_status = self.gripper.get_status()
        gripper_status.update({
            "last_open_width": self.last_open_width,
            "last_close_width": self.last_close_width,
        })
        
        return {
            "connected": self.connected,
            "arm": self.arm.get_status(),
            "gripper": gripper_status
        }


# ===================================================================
# WebSocket Bridge Server (UPDATED for width control)
# ===================================================================
class WebSocketBridge:
    """WebSocket server for robot control with width adjustment"""
    
    def __init__(self):
        self.robot = RobotSystem()
        self.clients = set()
    
    async def handle_client(self, websocket):
        """Handle a WebSocket client connection"""
        client_id = id(websocket)
        print(f"\n[WS] 🔌 New client connected: {client_id}")
        self.clients.add(websocket)
        
        try:
            # Send welcome message
            welcome = {
                "type": "welcome",
                "message": "Robot WebSocket Bridge Connected",
                "timestamp": time.time(),
                "system": "UR3e + OnRobot 2FG7/2FG14",
                "gripper_ip": "192.168.1.1:502",
                "arm_ip": "192.168.1.20:30002",
                "features": ["width_adjustment", "force_control", "speed_control"]
            }
            await websocket.send(json.dumps(welcome))
            
            # Main message loop
            async for message in websocket:
                try:
                    data = json.loads(message)
                    print(f"[WS] 📥 From {client_id}: {json.dumps(data)}")
                    
                    # Handle different message types
                    response = await self._handle_message(data)
                    if response:
                        await websocket.send(json.dumps(response))
                        
                except json.JSONDecodeError:
                    error = {"type": "error", "message": "Invalid JSON"}
                    await websocket.send(json.dumps(error))
                except Exception as e:
                    error = {"type": "error", "message": f"Processing error: {str(e)}"}
                    await websocket.send(json.dumps(error))
                    
        except websockets.exceptions.ConnectionClosed:
            print(f"[WS] 🔌 Client disconnected: {client_id}")
        finally:
            self.clients.remove(websocket)
    
    async def _handle_message(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Handle incoming WebSocket messages"""
        msg_type = data.get("type")
        
        if msg_type == "connect":
            # Connect to robot system
            if self.robot.connect():
                status = self.robot.get_status()
                return {
                    "type": "connected",
                    "message": "Robot system connected successfully",
                    "status": status
                }
            else:
                return {
                    "type": "error",
                    "message": "Failed to connect to robot system"
                }
        
        elif msg_type == "disconnect":
            # Disconnect from robot system
            self.robot.disconnect()
            return {
                "type": "disconnected",
                "message": "Robot system disconnected"
            }
        
        elif msg_type == "status":
            # Get system status
            return {
                "type": "status",
                "status": self.robot.get_status(),
                "timestamp": time.time()
            }
        
        elif msg_type == "move":
            # Execute robot move
            pose = data.get("pose")
            move_type = data.get("moveType", "clearance")
            
            if not pose:
                return {"type": "error", "message": "No pose provided"}
            
            if not self.robot.connected:
                return {"type": "error", "message": "Robot not connected"}
            
            success = self.robot.execute_move(pose, move_type)
            if success:
                return {
                    "type": "move_complete",
                    "message": f"Move completed: {move_type}",
                    "pose": pose,
                    "move_type": move_type
                }
            else:
                return {
                    "type": "error",
                    "message": "Move failed"
                }
        
        elif msg_type == "gripper":
            # Execute gripper action with optional parameters
            action = data.get("action")
            width_mm = data.get("width_mm")
            force_n = data.get("force_n", 20)
            speed_percent = data.get("speed_percent", 50)
            
            if action not in ["open", "close", "stop", "move_to_width"]:
                return {"type": "error", "message": f"Invalid gripper action: {action}"}
            
            if action == "move_to_width" and width_mm is None:
                return {"type": "error", "message": "Width must be specified for move_to_width"}
            
            if not self.robot.connected:
                return {"type": "error", "message": "Robot not connected"}
            
            success = self.robot.execute_gripper(action, width_mm, force_n, speed_percent)
            if success:
                return {
                    "type": "gripper_complete",
                    "message": f"Gripper {action} completed",
                    "action": action,
                    "width_mm": width_mm,
                    "force_n": force_n,
                    "speed_percent": speed_percent
                }
            else:
                return {
                    "type": "error",
                    "message": f"Gripper {action} failed"
                }
        
        elif msg_type == "set_gripper_config":
            # Set gripper configuration parameters
            if not self.robot.connected:
                return {"type": "error", "message": "Robot not connected"}
            
            # Get the gripper object
            gripper = self.robot.gripper
            
            # Apply configuration if provided
            success = True
            messages = []
            
            if "finger_length_mm" in data:
                if gripper.set_finger_length(data["finger_length_mm"]):
                    messages.append(f"Finger length set to {data['finger_length_mm']}mm")
                else:
                    success = False
                    messages.append("Failed to set finger length")
            
            if "finger_height_mm" in data:
                if gripper.set_finger_height(data["finger_height_mm"]):
                    messages.append(f"Finger height set to {data['finger_height_mm']}mm")
                else:
                    success = False
                    messages.append("Failed to set finger height")
            
            if "finger_orientation" in data:
                if gripper.set_finger_orientation(data["finger_orientation"]):
                    orientation = "inward" if data["finger_orientation"] == 0 else "outward"
                    messages.append(f"Finger orientation set to {orientation}")
                else:
                    success = False
                    messages.append("Failed to set finger orientation")
            
            if "fingertip_offset_mm" in data:
                if gripper.set_fingertip_offset(data["fingertip_offset_mm"]):
                    messages.append(f"Fingertip offset set to {data['fingertip_offset_mm']}mm")
                else:
                    success = False
                    messages.append("Failed to set fingertip offset")
            
            if success:
                return {
                    "type": "config_set",
                    "message": "Gripper configuration updated",
                    "details": messages
                }
            else:
                return {
                    "type": "error",
                    "message": "Some configuration updates failed",
                    "details": messages
                }
        
        elif msg_type == "test":
            # Test command
            return {
                "type": "test_response",
                "message": "Test successful",
                "received": data,
                "timestamp": time.time()
            }
        
        else:
            return {
                "type": "error",
                "message": f"Unknown message type: {msg_type}"
            }
    
    async def run(self, host="localhost", port=8765):
        """Run the WebSocket server"""
        print("\n" + "=" * 60)
        print("🚀 WEB SOCKET ROBOT BRIDGE WITH WIDTH CONTROL")
        print("=" * 60)
        print(f"📡 Listening on: ws://{host}:{port}")
        print("🤖 Supported commands:")
        print("  • connect - Connect to robot system")
        print("  • disconnect - Disconnect from robot system")
        print("  • status - Get system status")
        print("  • move - Move robot arm (with pose and moveType)")
        print("  • gripper - Control gripper (open/close/stop/move_to_width)")
        print("  • set_gripper_config - Set gripper parameters")
        print("  • test - Test command")
        print("\n💡 Example gripper commands:")
        print('  {"type": "gripper", "action": "open", "width_mm": 20.0, "force_n": 20, "speed_percent": 50}')
        print('  {"type": "gripper", "action": "close", "width_mm": 0.3, "force_n": 20, "speed_percent": 50}')
        print('  {"type": "gripper", "action": "move_to_width", "width_mm": 15.0, "force_n": 20, "speed_percent": 50}')
        print("=" * 60 + "\n")
        
        server = await websockets.serve(self.handle_client, host, port)
        await server.wait_closed()


# ===================================================================
# Main Entry Point
# ===================================================================
async def main():
    """Main function to run the bridge"""
    bridge = WebSocketBridge()
    await bridge.run()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n👋 Bridge shutdown by user")
    except Exception as e:
        print(f"\n❌ Fatal error: {e}")