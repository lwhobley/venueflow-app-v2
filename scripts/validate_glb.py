import struct
import json
import os

def validate_glb(path):
    with open(path, 'rb') as f:
        magic, version, length = struct.unpack('<III', f.read(12))
        assert magic == 0x46546C67, 'Invalid magic header'
        assert version == 2, 'Invalid glTF version'
        
        j_len, j_type = struct.unpack('<II', f.read(8))
        assert j_type == 0x4E4F534A, 'Invalid JSON chunk type'
        j_str = f.read(j_len).decode('utf-8')
        gltf = json.loads(j_str)
        
        b_len, b_type = struct.unpack('<II', f.read(8))
        assert b_type == 0x004E4942, 'Invalid BIN chunk type'
        bin_bytes = f.read(b_len)
        
        print("GLB Validation: PASSED")
        print(f"File: {path}")
        print(f"Total Size: {length:,} bytes ({length / 1024 / 1024:.2f} MB)")
        print(f"Nodes: {len(gltf.get('nodes', []))}")
        print(f"Meshes: {len(gltf.get('meshes', []))}")
        print(f"Materials: {len(gltf.get('materials', []))}")
        print(f"Buffer Views: {len(gltf.get('bufferViews', []))}")
        print(f"Accessors: {len(gltf.get('accessors', []))}")
        return True

if __name__ == "__main__":
    glb_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "nrg-stadium.glb")
    validate_glb(glb_path)
