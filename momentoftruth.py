import tkinter as tk
from tkinter import ttk
import socket
import struct
import time
import threading

class SimpleGripperControl:
    """Direct TCP Modbus communication - No pymodbus dependency"""
    
    def __init__(self, ip="192.168.1.1", port=502, unit_id=65):
        self.ip = ip
        self.port = port
        self.unit_id = unit_id
        self.sock = None
        self.transaction_id = 1
        self.lock = threading.Lock()  # For thread safety
        
    def connect(self):
        """Establish connection to Compute Box"""
        try:
            with self.lock:
                if self.sock:
                    self.sock.close()
                
                self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self.sock.settimeout(3.0)
                self.sock.connect((self.ip, self.port))
                print(f"✓ Connected to {self.ip}:{self.port}")
                return True
        except Exception as e:
            print(f"✗ Connection error: {e}")
            return False
    
    def disconnect(self):
        """Close connection"""
        with self.lock:
            if self.sock:
                self.sock.close()
                self.sock = None
                print("Disconnected")
    
    def _send_modbus_request(self, function_code, data):
        """Send raw Modbus TCP request and get response"""
        if not self.sock:
            return None
            
        with self.lock:
            try:
                # Increment transaction ID
                transaction_id = self.transaction_id
                self.transaction_id = (self.transaction_id + 1) % 65536
                
                # Build MBAP header
                # Transaction ID (2), Protocol ID (2), Length (2), Unit ID (1)
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
                    print(f"Invalid header length: {len(header)}")
                    return None
                
                # Parse response header
                resp_trans_id, resp_proto_id, resp_length, resp_unit_id = struct.unpack('>HHHB', header)
                
                # Receive remaining data
                data_len = resp_length - 1  # Subtract unit_id byte
                if data_len > 0:
                    response_data = self.sock.recv(data_len)
                    if len(response_data) != data_len:
                        print(f"Incomplete data: got {len(response_data)}, expected {data_len}")
                        return None
                else:
                    response_data = b''
                
                # Check if it's an exception response
                if response_data[0] == function_code + 0x80:
                    print(f"Modbus exception: code {response_data[1]}")
                    return None
                
                return response_data
                
            except socket.timeout:
                print("Timeout sending/receiving data")
                return None
            except Exception as e:
                print(f"Communication error: {e}")
                return None
    
    def read_holding_register(self, address):
        """Read a single holding register (Function Code 0x03)"""
        # Build PDU: Function Code (1), Address (2), Quantity (2)
        pdu = struct.pack('>BHH', 0x03, address, 1)
        
        response = self._send_modbus_request(0x03, pdu)
        if response and len(response) >= 3:
            # Response format: FC (1), Byte Count (1), Data (2*N)
            if response[0] == 0x03 and response[1] == 2:
                value = struct.unpack('>H', response[2:4])[0]
                return value
        
        print(f"Failed to read register {address}")
        return None
    
    def write_single_register(self, address, value):
        """Write a single register (Function Code 0x06)"""
        # Build PDU: Function Code (1), Address (2), Value (2)
        pdu = struct.pack('>BHH', 0x06, address, value)
        
        response = self._send_modbus_request(0x06, pdu)
        if response and len(response) >= 5:
            # Response should echo the request
            if response[0] == 0x06:
                return True
        
        print(f"Failed to write register {address}")
        return False
    
    def get_product_info(self):
        """Read product code to verify connection"""
        return self.read_holding_register(1536)
    
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
        
        if success:
            print(f"✓ Set: Width={width_mm}mm, Force={force_n}N, Speed={speed_percent}%")
        else:
            print("✗ Failed to set parameters")
        
        return success
    
    def execute_command(self, command):
        """Execute gripper command (1=grip external, 2=grip internal, 3=stop)"""
        return self.write_single_register(3, command)
    
    def full_open(self, force_n=20, speed_percent=50):
        """Open gripper to maximum width"""
        min_width, max_width = self.get_limits()
        if max_width is None:
            print("✗ Could not read max width")
            return False
        
        print(f"Max width: {max_width}mm")
        
        # Set parameters
        if self.set_gripper_parameters(max_width, force_n, speed_percent):
            time.sleep(0.1)  # Small delay
            if self.execute_command(1):  # Grip external command
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
        
        print(f"Min width: {min_width}mm")
        
        # Set parameters
        if self.set_gripper_parameters(min_width, force_n, speed_percent):
            time.sleep(0.1)  # Small delay
            if self.execute_command(1):  # Grip external command
                print(f"✓ Closing to {min_width}mm")
                return True
        
        print("✗ Failed to close gripper")
        return False
    
    def stop(self):
        """Stop gripper movement"""
        return self.execute_command(3)


class GripperGUI:
    """Simple GUI for gripper control"""
    
    def __init__(self):
        self.gripper = SimpleGripperControl()
        self.root = tk.Tk()
        self.root.title("OnRobot 2FG7 Gripper Control")
        self.root.geometry("500x400")
        
        # Configure style
        self.root.configure(bg='#f0f0f0')
        
        self.setup_ui()
        self.update_status()
    
    def setup_ui(self):
        # Title
        title_label = tk.Label(self.root, text="OnRobot 2FG7 Gripper Controller", 
                              font=("Arial", 16, "bold"), bg='#f0f0f0')
        title_label.pack(pady=10)
        
        # Connection Frame
        conn_frame = tk.Frame(self.root, bg='#e0e0e0', relief=tk.RAISED, bd=2)
        conn_frame.pack(fill=tk.X, padx=10, pady=5)
        
        tk.Label(conn_frame, text="Status:", font=("Arial", 10), 
                bg='#e0e0e0').pack(side=tk.LEFT, padx=5, pady=5)
        
        self.status_label = tk.Label(conn_frame, text="Disconnected", 
                                    font=("Arial", 10, "bold"), fg="red", bg='#e0e0e0')
        self.status_label.pack(side=tk.LEFT, padx=5, pady=5)
        
        self.connect_btn = tk.Button(conn_frame, text="CONNECT", 
                                    command=self.connect_gripper,
                                    font=("Arial", 10, "bold"),
                                    bg='#4CAF50', fg='white',
                                    padx=20, pady=5)
        self.connect_btn.pack(side=tk.RIGHT, padx=10, pady=5)
        
        # Control Frame
        control_frame = tk.Frame(self.root, bg='#f0f0f0')
        control_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Open/Close Buttons
        btn_frame = tk.Frame(control_frame, bg='#f0f0f0')
        btn_frame.pack(pady=20)
        
        self.open_btn = tk.Button(btn_frame, text="FULL OPEN", 
                                 command=self.open_gripper,
                                 font=("Arial", 12, "bold"),
                                 bg='#2196F3', fg='white',
                                 width=15, height=2,
                                 state=tk.DISABLED)
        self.open_btn.pack(side=tk.LEFT, padx=10)
        
        self.close_btn = tk.Button(btn_frame, text="FULL CLOSE", 
                                  command=self.close_gripper,
                                  font=("Arial", 12, "bold"),
                                  bg='#f44336', fg='white',
                                  width=15, height=2,
                                  state=tk.DISABLED)
        self.close_btn.pack(side=tk.LEFT, padx=10)
        
        # Stop Button
        self.stop_btn = tk.Button(control_frame, text="STOP", 
                                 command=self.stop_gripper,
                                 font=("Arial", 10, "bold"),
                                 bg='#FF9800', fg='white',
                                 width=10, height=1,
                                 state=tk.DISABLED)
        self.stop_btn.pack(pady=10)
        
        # Information Display
        info_frame = tk.Frame(self.root, bg='#ffffff', relief=tk.SUNKEN, bd=1)
        info_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)
        
        tk.Label(info_frame, text="Gripper Information", 
                font=("Arial", 11, "bold"), bg='#ffffff').pack(pady=5)
        
        self.info_text = tk.Text(info_frame, height=8, width=60, 
                                font=("Courier", 9), wrap=tk.WORD)
        self.info_text.pack(padx=10, pady=5, fill=tk.BOTH, expand=True)
        
        # Add scrollbar
        scrollbar = tk.Scrollbar(info_frame, command=self.info_text.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.info_text.config(yscrollcommand=scrollbar.set)
        
        # Status Bar
        self.status_bar = tk.Label(self.root, text="Ready", bd=1, 
                                  relief=tk.SUNKEN, anchor=tk.W, 
                                  bg='#e0e0e0')
        self.status_bar.pack(side=tk.BOTTOM, fill=tk.X)
    
    def log_message(self, message):
        """Add message to info text and status bar"""
        timestamp = time.strftime("%H:%M:%S")
        self.info_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.info_text.see(tk.END)
        self.status_bar.config(text=message)
        print(message)
    
    def connect_gripper(self):
        """Connect to the gripper"""
        self.log_message("Connecting to gripper...")
        
        if self.gripper.connect():
            self.connect_btn.config(state=tk.DISABLED)
            self.open_btn.config(state=tk.NORMAL)
            self.close_btn.config(state=tk.NORMAL)
            self.stop_btn.config(state=tk.NORMAL)
            self.status_label.config(text="Connected", fg="green")
            
            # Read product code to verify
            product_code = self.gripper.get_product_info()
            if product_code:
                self.log_message(f"✓ Connected! Product code: {product_code} (0x{product_code:04X})")
                
                # Identify gripper type
                if product_code == 0xC0:
                    self.log_message("Gripper: 2FG7 (13-31mm)")
                elif product_code == 0xC1:
                    self.log_message("Gripper: 2FG14 (22-48mm)")
                else:
                    self.log_message(f"Unknown gripper type: {product_code}")
            else:
                self.log_message("✓ Connected but couldn't read product code")
        else:
            self.log_message("✗ Connection failed")
            self.status_label.config(text="Failed", fg="red")
    
    def open_gripper(self):
        """Open gripper fully"""
        self.log_message("Opening gripper...")
        self.open_btn.config(state=tk.DISABLED)
        self.close_btn.config(state=tk.DISABLED)
        
        # Run in a thread to avoid freezing GUI
        def open_thread():
            if self.gripper.full_open():
                self.root.after(0, lambda: self.log_message("✓ Gripper fully opened"))
            else:
                self.root.after(0, lambda: self.log_message("✗ Failed to open gripper"))
            
            # Re-enable buttons
            self.root.after(0, lambda: [
                self.open_btn.config(state=tk.NORMAL),
                self.close_btn.config(state=tk.NORMAL)
            ])
        
        threading.Thread(target=open_thread, daemon=True).start()
    
    def close_gripper(self):
        """Close gripper fully"""
        self.log_message("Closing gripper...")
        self.open_btn.config(state=tk.DISABLED)
        self.close_btn.config(state=tk.DISABLED)
        
        # Run in a thread to avoid freezing GUI
        def close_thread():
            if self.gripper.full_close():
                self.root.after(0, lambda: self.log_message("✓ Gripper fully closed"))
            else:
                self.root.after(0, lambda: self.log_message("✗ Failed to close gripper"))
            
            # Re-enable buttons
            self.root.after(0, lambda: [
                self.open_btn.config(state=tk.NORMAL),
                self.close_btn.config(state=tk.NORMAL)
            ])
        
        threading.Thread(target=close_thread, daemon=True).start()
    
    def stop_gripper(self):
        """Stop gripper movement"""
        if self.gripper.stop():
            self.log_message("✓ Gripper stopped")
        else:
            self.log_message("✗ Failed to stop gripper")
    
    def update_status(self):
        """Update status information periodically"""
        if hasattr(self, 'gripper') and hasattr(self.gripper, 'sock') and self.gripper.sock:
            try:
                # Read current width
                width = self.gripper.get_current_width()
                if width is not None:
                    # Clear info text and show current status
                    self.info_text.delete(1.0, tk.END)
                    self.info_text.insert(tk.END, f"Current Width: {width:.1f} mm\n\n")
                    
                    # Get limits
                    min_width, max_width = self.gripper.get_limits()
                    if min_width is not None and max_width is not None:
                        self.info_text.insert(tk.END, f"Min Width: {min_width:.1f} mm\n")
                        self.info_text.insert(tk.END, f"Max Width: {max_width:.1f} mm\n\n")
                    
                    # Get status
                    status = self.gripper.get_status()
                    if status:
                        self.info_text.insert(tk.END, "Status:\n")
                        self.info_text.insert(tk.END, f"  Busy: {'Yes' if status['busy'] else 'No'}\n")
                        self.info_text.insert(tk.END, f"  Grip Detected: {'Yes' if status['grip_detected'] else 'No'}\n")
                        
                        if status['error_not_calibrated']:
                            self.info_text.insert(tk.END, "  ⚠ ERROR: Not calibrated\n")
                        if status['error_linear_sensor']:
                            self.info_text.insert(tk.END, "  ⚠ ERROR: Linear sensor\n")
            except Exception as e:
                print(f"Error updating status: {e}")
        
        # Schedule next update
        self.root.after(1000, self.update_status)
    
    def on_closing(self):
        """Handle window closing"""
        self.gripper.disconnect()
        self.root.destroy()
    
    def run(self):
        """Run the GUI application"""
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.root.mainloop()


# Alternative: Command-line version for quick testing
def command_line_test():
    """Simple command-line interface for testing"""
    print("=" * 50)
    print("OnRobot 2FG7 Gripper Test")
    print("=" * 50)
    
    gripper = SimpleGripperControl()
    
    if not gripper.connect():
        print("Connection failed. Exiting...")
        return
    
    # Read product code
    product_code = gripper.get_product_info()
    if product_code:
        print(f"✓ Product code: {product_code} (0x{product_code:04X})")
        if product_code == 0xC0:
            print("Gripper: 2FG7")
        elif product_code == 0xC1:
            print("Gripper: 2FG14")
    else:
        print("✗ Could not read product code")
    
    # Read current width
    width = gripper.get_current_width()
    if width is not None:
        print(f"Current width: {width:.1f} mm")
    
    # Read limits
    min_width, max_width = gripper.get_limits()
    if min_width is not None and max_width is not None:
        print(f"Min width: {min_width:.1f} mm")
        print(f"Max width: {max_width:.1f} mm")
    
    while True:
        print("\nOptions:")
        print("1. Full Close")
        print("2. Full Open")
        print("3. Stop")
        print("4. Read Width")
        print("5. Exit")
        
        choice = input("\nEnter choice (1-5): ").strip()
        
        if choice == "1":
            print("Closing gripper...")
            if gripper.full_close():
                print("✓ Closed successfully")
            else:
                print("✗ Failed to close")
        
        elif choice == "2":
            print("Opening gripper...")
            if gripper.full_open():
                print("✓ Opened successfully")
            else:
                print("✗ Failed to open")
        
        elif choice == "3":
            if gripper.stop():
                print("✓ Stopped")
            else:
                print("✗ Failed to stop")
        
        elif choice == "4":
            width = gripper.get_current_width()
            if width is not None:
                print(f"Current width: {width:.1f} mm")
            else:
                print("✗ Failed to read width")
        
        elif choice == "5":
            break
        
        else:
            print("Invalid choice. Please enter 1-5.")
    
    gripper.disconnect()
    print("Goodbye!")


if __name__ == "__main__":
    print("Select mode:")
    print("1. GUI Mode (Recommended)")
    print("2. Command Line Mode")
    
    mode = input("Enter choice (1 or 2): ").strip()
    
    if mode == "2":
        command_line_test()
    else:
        app = GripperGUI()
        app.run()