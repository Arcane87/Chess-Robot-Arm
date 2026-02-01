import socket
import time
import threading
import struct
import json
import os
from pynput import keyboard

# ================== CONFIG ==================
ROBOT_IP = "192.168.1.20"
PORT = 30002

# Gripper config
GRIPPER_IP = "192.168.1.1"
GRIPPER_PORT = 502
GRIPPER_UNIT_ID = 65

# Pose file path - UPDATE THIS TO YOUR ACTUAL PATH
POSE_FILE_PATH = r"C:\Users\wunna\Downloads\chesswebcammaintransferfile\public\chessboard_poses.json"

# Movement parameters
MAX_LIN_SPEED = 0.05      # m/s
MAX_ROT_SPEED = 0.3       # rad/s
ACCELERATION = 0.2
SPEEDL_TIME = 10.0
LOOP_RATE = 0.02

# Pose movement parameters - SIMPLIFIED
POSE_ACCELERATION = 0.3
POSE_VELOCITY = 0.15
POSE_WAIT_TIME = 3.0      # Wait 5 seconds after sending move command
# ============================================

velocity = [0, 0, 0, 0, 0, 0]
last_sent_velocity = [0, 0, 0, 0, 0, 0]
vel_lock = threading.Lock()
running = True
gripper_busy = False
gripper_lock = threading.Lock()

# State variables for pose movement
pose_moving = False
cancel_pose_move = False
current_pose_target = None
poses = {}

# ================= KEY MAP ==================
KEY_MAP = {
    'w': (0, +1), 's': (0, -1),
    'a': (1, +1), 'd': (1, -1),
    'q': (2, +1), 'e': (2, -1),
    'i': (3, +1), 'k': (3, -1),
    'j': (4, +1), 'l': (4, -1),
    'u': (5, +1), 'o': (5, -1),
    # Gripper keys
    'g': 'close',  # Close gripper
    'h': 'open',   # Open gripper
    'y': 'stop',   # Stop gripper
    # Pose movement keys (will be handled separately)
    '1': 'pose1', '2': 'pose2', '3': 'pose3',
    '4': 'pose4', '5': 'pose5', '6': 'pose6',
    # Optional: add home and drop poses if they exist in JSON
    '7': 'home', '8': 'drop',
}
# ============================================

def load_poses():
    """Load poses from JSON file"""
    global poses
    if not os.path.exists(POSE_FILE_PATH):
        print(f"⚠️  Pose file not found: {POSE_FILE_PATH}")
        print("⚠️  Pose movement keys (1-6) will not work")
        return False
    
    try:
        with open(POSE_FILE_PATH, 'r') as f:
            poses = json.load(f)
        print(f"✓ Loaded poses from {POSE_FILE_PATH}")
        
        # List available poses
        if 'corners' in poses:
            print(f"  - {len(poses['corners'])} corners available")
            for i, corner in enumerate(poses['corners']):
                print(f"    {i+1}: [{corner['x']:.3f}, {corner['y']:.3f}, {corner['z']:.3f}]")
        if 'home' in poses:
            print("  - Home pose available")
        if 'drop' in poses:
            print("  - Drop pose available")
            
        return True
    except Exception as e:
        print(f"✗ Error loading poses: {e}")
        return False

class SimpleGripperControl:
    """Direct TCP Modbus communication for OnRobot 2FG7 Gripper"""
    
    def __init__(self, ip=GRIPPER_IP, port=GRIPPER_PORT, unit_id=GRIPPER_UNIT_ID):
        self.ip = ip
        self.port = port
        self.unit_id = unit_id
        self.sock = None
        self.transaction_id = 1
        self.connected = False
        self.last_command = None
        
    def connect(self):
        """Establish connection to Compute Box"""
        try:
            if self.sock:
                self.sock.close()
            
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(2.0)
            self.sock.connect((self.ip, self.port))
            self.connected = True
            print(f"✓ Gripper connected to {self.ip}:{self.port}")
            return True
        except Exception as e:
            print(f"✗ Gripper connection error: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Close connection"""
        if self.sock:
            self.sock.close()
            self.sock = None
            self.connected = False
            print("Gripper disconnected")
    
    def _send_modbus_request(self, function_code, data):
        """Send raw Modbus TCP request and get response"""
        if not self.sock or not self.connected:
            return None
            
        try:
            # Increment transaction ID
            transaction_id = self.transaction_id
            self.transaction_id = (self.transaction_id + 1) % 65536
            
            # Build MBAP header
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
                return None
            
            # Parse response header
            resp_trans_id, resp_proto_id, resp_length, resp_unit_id = struct.unpack('>HHHB', header)
            
            # Receive remaining data
            data_len = resp_length - 1  # Subtract unit_id byte
            if data_len > 0:
                response_data = self.sock.recv(data_len)
                if len(response_data) != data_len:
                    return None
            else:
                response_data = b''
            
            # Check if it's an exception response
            if response_data[0] == function_code + 0x80:
                return None
            
            return response_data
            
        except Exception:
            self.connected = False
            return None
    
    def read_holding_register(self, address):
        """Read a single holding register (Function Code 0x03)"""
        if not self.connected:
            return None
            
        # Build PDU: Function Code (1), Address (2), Quantity (2)
        pdu = struct.pack('>BHH', 0x03, address, 1)
        
        response = self._send_modbus_request(0x03, pdu)
        if response and len(response) >= 3:
            # Response format: FC (1), Byte Count (1), Data (2*N)
            if response[0] == 0x03 and response[1] == 2:
                value = struct.unpack('>H', response[2:4])[0]
                return value
        
        return None
    
    def write_single_register(self, address, value):
        """Write a single register (Function Code 0x06)"""
        if not self.connected:
            return False
            
        # Build PDU: Function Code (1), Address (2), Value (2)
        pdu = struct.pack('>BHH', 0x06, address, value)
        
        response = self._send_modbus_request(0x06, pdu)
        if response and len(response) >= 5:
            # Response should echo the request
            if response[0] == 0x06:
                return True
        
        return False
    
    def get_current_width(self):
        """Get current external width in mm"""
        value = self.read_holding_register(257)  # 0x0101 External width
        if value is not None:
            return value / 10.0  # Convert from 1/10 mm to mm
        return None
    
    def get_limits(self):
        """Get min and max width in mm"""
        min_val = self.read_holding_register(259)  # 0x0103 Min external width
        max_val = self.read_holding_register(260)  # 0x0104 Max external width
        
        if min_val is not None and max_val is not None:
            return min_val/10.0, max_val/10.0  # Convert to mm
        return None, None
    
    def get_status(self):
        """Get gripper status"""
        value = self.read_holding_register(256)  # 0x0100 Status
        if value is not None:
            return {
                'busy': bool(value & 0x0001),
                'grip_detected': bool(value & 0x0002),
                'error_not_calibrated': bool(value & 0x0008),
                'error_linear_sensor': bool(value & 0x0010)
            }
        return None
    
    def set_gripper_parameters(self, width_mm, force_n=20, speed_percent=50):
        """Set gripper parameters"""
        if not self.connected:
            return False
            
        # Convert width to 1/10 mm
        width_units = int(width_mm * 10)
        
        # Set parameters with error checking
        success = True
        if not self.write_single_register(0, width_units):    # Target width
            success = False
        if not self.write_single_register(1, force_n):        # Target force
            success = False
        if not self.write_single_register(2, speed_percent):  # Target speed
            success = False
        
        return success
    
    def execute_command(self, command):
        """Execute gripper command (1=grip external, 2=grip internal, 3=stop)"""
        if not self.connected:
            return False
        return self.write_single_register(3, command)
    
    def full_open(self, force_n=20, speed_percent=50):
        """Open gripper to maximum width"""
        min_width, max_width = self.get_limits()
        if max_width is None:
            print("✗ Could not read max width")
            return False
        
        # Set parameters
        if self.set_gripper_parameters(max_width, force_n, speed_percent):
            time.sleep(0.1)  # Small delay
            if self.execute_command(1):  # Grip external command
                self.last_command = 'open'
                print(f"✓ Opening to {max_width}mm")
                return True
        
        print("✗ Failed to open gripper")
        return False
    
    def full_close(self, force_n=20, speed_percent=50):
        """Close gripper to minimum width"""
        min_width, max_width = self.get_limits()
        if min_width is None:
            print("✗ Could not read min width")
            return False
        
        # Set parameters
        if self.set_gripper_parameters(min_width, force_n, speed_percent):
            time.sleep(0.1)  # Small delay
            if self.execute_command(1):  # Grip external command
                self.last_command = 'close'
                print(f"✓ Closing to {min_width}mm")
                return True
        
        print("✗ Failed to close gripper")
        return False
    
    def stop(self):
        """Stop gripper movement"""
        if not self.connected:
            return False
        result = self.execute_command(3)
        if result:
            print("✓ Gripper stopped")
        return result

def velocities_equal(v1, v2, eps=1e-4):
    return all(abs(a - b) < eps for a, b in zip(v1, v2))


class URJogController:
    def __init__(self, ip, port):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.connect((ip, port))
        self.sock.sendall(b'textmsg("Keyboard jog connected")\n')
        
    def send(self, cmd):
        """Send command to robot"""
        self.sock.sendall((cmd + "\n").encode())
        
    def send_movel(self, pose, pose_name=""):
        """Send movel command to specific pose"""
        cmd = (f"movel(p[{pose['x']:.5f}, {pose['y']:.5f}, {pose['z']:.5f}, "
               f"{pose['rx']:.5f}, {pose['ry']:.5f}, {pose['rz']:.5f}], "
               f"a={POSE_ACCELERATION}, v={POSE_VELOCITY})")
        
        if pose_name:
            self.send(f'textmsg("Moving to {pose_name}")')
        self.send(cmd)
        
    def move_to_pose(self, pose, pose_name=""):
        """Send move command and wait fixed time"""
        global pose_moving, cancel_pose_move
        
        if pose_name:
            print(f"➡️  Moving to {pose_name}...")
        
        pose_moving = True
        cancel_pose_move = False
        
        # Send the movement command
        self.send_movel(pose, pose_name)
        
        # SIMPLE APPROACH: Just wait 5 seconds
        # The robot will reach the position and stop automatically
        wait_time = POSE_WAIT_TIME
        step = 0.1  # Check for cancellation every 0.1 seconds
        
        for i in range(int(wait_time / step)):
            if cancel_pose_move:
                print(f"⚠️  {pose_name} movement cancelled!")
                self.send("stopl(0.5)")
                break
            time.sleep(step)
        else:
            if not cancel_pose_move:
                print(f"✓ {pose_name} movement complete (waited {POSE_WAIT_TIME}s)")
        
        pose_moving = False
        cancel_pose_move = False
        
    def loop(self):
        """Main control loop for continuous velocity control"""
        global last_sent_velocity, pose_moving
        
        while running:
            # If we're in the middle of a pose move, skip velocity control
            if pose_moving:
                time.sleep(LOOP_RATE)
                continue
                
            with vel_lock:
                v = velocity.copy()

            if not velocities_equal(v, last_sent_velocity):
                if any(abs(x) > 1e-4 for x in v):
                    cmd = (
                        f"speedl([{v[0]:.4f},{v[1]:.4f},{v[2]:.4f},"
                        f"{v[3]:.4f},{v[4]:.4f},{v[5]:.4f}],"
                        f"a={ACCELERATION},t={SPEEDL_TIME})"
                    )
                else:
                    cmd = "stopl(0.5)"

                self.send(cmd)
                last_sent_velocity = v

            time.sleep(LOOP_RATE)

        self.send("stopl(0.5)")
        self.sock.close()


def gripper_command_thread(command_type, gripper):
    """Thread function for gripper commands"""
    global gripper_busy
    
    with gripper_lock:
        if gripper_busy:
            print(f"⚠ Gripper is busy. Ignoring {command_type} command.")
            return
        
        gripper_busy = True
    
    try:
        if command_type == 'open':
            gripper.full_open()
        elif command_type == 'close':
            gripper.full_close()
        elif command_type == 'stop':
            gripper.stop()
    except Exception as e:
        print(f"✗ Gripper error during {command_type}: {e}")
    finally:
        with gripper_lock:
            gripper_busy = False


def pose_move_thread(pose_key, controller):
    """Thread function for pose movement"""
    global pose_moving, cancel_pose_move, poses
    
    # Map key to pose
    pose_mapping = {
        '1': ('corner1', 'corners', 0),
        '2': ('corner2', 'corners', 1),
        '3': ('corner3', 'corners', 2),
        '4': ('corner4', 'corners', 3),
        '5': ('corner5', 'corners', 4),
        '6': ('corner6', 'corners', 5),
        '7': ('home', 'home', 0),
        '8': ('drop', 'drop', 0),
    }
    
    if pose_key not in pose_mapping:
        print(f"❌ Unknown pose key: {pose_key}")
        return
    
    pose_name, pose_type, index = pose_mapping[pose_key]
    
    # Get the pose from loaded poses
    if pose_type == 'corners':
        if 'corners' not in poses or index >= len(poses['corners']):
            print(f"❌ Corner {index+1} not available in poses")
            return
        target_pose = poses['corners'][index]
    else:  # home or drop
        if pose_type not in poses:
            print(f"❌ {pose_type.capitalize()} pose not available")
            return
        target_pose = poses[pose_type]
    
    # Start the pose movement
    controller.move_to_pose(target_pose, pose_name)


def on_press(key, gripper, controller):
    global gripper_busy, cancel_pose_move, pose_moving
    
    try:
        k = key.char.lower()
        
        # Check if pose movement is active and movement key is pressed
        if pose_moving and k in ['w', 's', 'a', 'd', 'q', 'e', 'i', 'k', 'j', 'l', 'u', 'o']:
            print("⚠️  Cancelling pose movement for manual control...")
            cancel_pose_move = True
            # Also set velocity for immediate manual control
            axis, direction = KEY_MAP[k]
            with vel_lock:
                if axis < 3:
                    velocity[axis] = direction * MAX_LIN_SPEED
                else:
                    velocity[axis] = direction * MAX_ROT_SPEED
            return
        
        if k in KEY_MAP:
            action = KEY_MAP[k]
            
            # Handle gripper commands
            if isinstance(action, str):
                if action in ['close', 'open', 'stop']:
                    # Start gripper command in separate thread
                    threading.Thread(target=gripper_command_thread, 
                                   args=(action, gripper), 
                                   daemon=True).start()
                elif action.startswith('pose') or action in ['home', 'drop']:
                    # Handle pose movement commands
                    if pose_moving:
                        print("⚠️  Already moving to a pose. Wait or cancel with movement key.")
                    else:
                        threading.Thread(target=pose_move_thread,
                                       args=(k, controller),
                                       daemon=True).start()
            else:
                # Handle robot movement keys
                axis, direction = action
                with vel_lock:
                    if axis < 3:
                        velocity[axis] = direction * MAX_LIN_SPEED
                    else:
                        velocity[axis] = direction * MAX_ROT_SPEED
                        
    except AttributeError:
        if key == keyboard.Key.esc:
            return False


def on_release(key):
    try:
        k = key.char.lower()
        if k in KEY_MAP:
            action = KEY_MAP[k]
            # Only reset velocity for movement keys
            if isinstance(action, tuple):
                axis, _ = action
                with vel_lock:
                    velocity[axis] = 0.0
    except AttributeError:
        pass


# ================= MAIN ==================
print("\n" + "="*60)
print("🤖 UR3 Keyboard Control with Pose Movement")
print("="*60)
print("\n📌 Robot Movement (Continuous):")
print("  W/S: Forward/Backward  A/D: Left/Right  Q/E: Up/Down")
print("  I/K: Pitch             J/L: Yaw         U/O: Roll")
print("\n🎯 Pose Movement (Discrete):")
print("  1-6: Move to saved corners 1-6")
print("  7: Move to Home pose       8: Move to Drop pose")
print("\n🤖 Gripper Control:")
print("  G: Close Gripper       H: Open Gripper  Y: Stop Gripper")
print("\n⏹️  Controls:")
print("  ESC: Quit program")
print("  Movement keys during pose move: Cancel pose move")
print("  Note: Pose moves wait 5 seconds after sending command")
print("="*60 + "\n")

# Load poses from JSON file
pose_loaded = load_poses()

# Initialize and connect to robot
controller = URJogController(ROBOT_IP, PORT)

# Initialize and connect to gripper
gripper = SimpleGripperControl()
gripper_connected = False

print("🔌 Connecting to gripper...")
if gripper.connect():
    gripper_connected = True
    # Verify connection by reading product info
    product_code = gripper.read_holding_register(1536)
    if product_code:
        if product_code == 0xC0:
            print("✓ Gripper: 2FG7 (13-31mm) detected")
        elif product_code == 0xC1:
            print("✓ Gripper: 2FG14 (22-48mm) detected")
        else:
            print(f"✓ Unknown gripper type detected (code: {product_code})")
    else:
        print("⚠ Gripper connected but couldn't read product info")
else:
    print("⚠ Gripper not connected. Gripper commands will be ignored.")

# Start robot control thread
robot_thread = threading.Thread(target=controller.loop, daemon=True)
robot_thread.start()

# Create keyboard listener with gripper and controller as arguments
listener = keyboard.Listener(
    on_press=lambda key: on_press(key, gripper, controller),
    on_release=on_release
)
listener.start()

print("✅ Ready for control. Press ESC to exit.")
print("ℹ️  Tip: Press any movement key (WASD, etc.) during pose movement to cancel it.")
print(f"ℹ️  Pose moves: Send command → Robot moves → Wait {POSE_WAIT_TIME}s → Ready\n")

# Keep main thread alive
try:
    while listener.running:
        time.sleep(0.1)
except KeyboardInterrupt:
    pass
finally:
    running = False
    if gripper_connected:
        gripper.disconnect()
    
    # Wait for threads to finish
    robot_thread.join(timeout=1.0)
    listener.stop()
    
    print("\n🛑 Disconnected cleanly")