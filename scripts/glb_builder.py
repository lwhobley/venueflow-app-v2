import struct
import json
import math
import numpy as np
import os

class GLBBuilder:
    def __init__(self):
        self.bin_data = bytearray()
        self.accessors = []
        self.buffer_views = []
        self.meshes = []
        self.nodes = []
        self.materials = []
        self.textures = []
        self.images = []
        self.samplers = []
        self.scene_nodes = []

    def add_material(self, name, base_color=(1.0, 1.0, 1.0, 1.0), metallic=0.1, roughness=0.7, emissive=(0, 0, 0), double_sided=False):
        mat = {
            "name": name,
            "pbrMetallicRoughness": {
                "baseColorFactor": list(base_color),
                "metallicFactor": metallic,
                "roughnessFactor": roughness
            },
            "doubleSided": double_sided
        }
        if any(e > 0 for e in emissive):
            mat["emissiveFactor"] = list(emissive)
        self.materials.append(mat)
        return len(self.materials) - 1

    def _align_bin(self, alignment=4):
        pad = (alignment - (len(self.bin_data) % alignment)) % alignment
        if pad > 0:
            self.bin_data.extend(b'\x00' * pad)

    def add_buffer_view(self, data_bytes, target=None):
        self._align_bin(4)
        offset = len(self.bin_data)
        byte_length = len(data_bytes)
        self.bin_data.extend(data_bytes)
        
        bv = {
            "buffer": 0,
            "byteOffset": offset,
            "byteLength": byte_length
        }
        if target is not None:
            bv["target"] = target
        self.buffer_views.append(bv)
        return len(self.buffer_views) - 1

    def add_accessor(self, buffer_view_idx, component_type, count, acc_type, min_val=None, max_val=None):
        acc = {
            "bufferView": buffer_view_idx,
            "byteOffset": 0,
            "componentType": component_type,
            "count": count,
            "type": acc_type
        }
        if min_val is not None:
            acc["min"] = min_val
        if max_val is not None:
            acc["max"] = max_val
        self.accessors.append(acc)
        return len(self.accessors) - 1

    def add_mesh_primitive(self, name, positions, normals, indices, material_idx, uvs=None):
        pos_np = np.array(positions, dtype=np.float32)
        norm_np = np.array(normals, dtype=np.float32)
        idx_np = np.array(indices, dtype=np.uint32)

        min_pos = pos_np.min(axis=0).tolist()
        max_pos = pos_np.max(axis=0).tolist()

        # Vertex positions
        pos_bv = self.add_buffer_view(pos_np.tobytes(), target=34962) # ARRAY_BUFFER
        pos_acc = self.add_accessor(pos_bv, 5126, len(positions), "VEC3", min_pos, max_pos) # 5126 = FLOAT

        # Normals
        norm_bv = self.add_buffer_view(norm_np.tobytes(), target=34962)
        norm_acc = self.add_accessor(norm_bv, 5126, len(normals), "VEC3")

        # Indices
        idx_bv = self.add_buffer_view(idx_np.tobytes(), target=34963) # ELEMENT_ARRAY_BUFFER
        idx_acc = self.add_accessor(idx_bv, 5125, len(indices), "SCALAR", [int(idx_np.min())], [int(idx_np.max())]) # 5125 = UNSIGNED_INT

        attributes = {
            "POSITION": pos_acc,
            "NORMAL": norm_acc
        }

        if uvs is not None and len(uvs) == len(positions):
            uv_np = np.array(uvs, dtype=np.float32)
            uv_bv = self.add_buffer_view(uv_np.tobytes(), target=34962)
            uv_acc = self.add_accessor(uv_bv, 5126, len(uvs), "VEC2")
            attributes["TEXCOORD_0"] = uv_acc

        mesh = {
            "name": name,
            "primitives": [{
                "attributes": attributes,
                "indices": idx_acc,
                "material": material_idx
            }]
        }
        self.meshes.append(mesh)
        return len(self.meshes) - 1

    def add_node(self, name, mesh_idx=None, translation=None, rotation=None, scale=None, children=None):
        node = {"name": name}
        if mesh_idx is not None:
            node["mesh"] = mesh_idx
        if translation is not None:
            node["translation"] = translation
        if rotation is not None:
            node["rotation"] = rotation
        if scale is not None:
            node["scale"] = scale
        if children is not None and len(children) > 0:
            node["children"] = children
        self.nodes.append(node)
        return len(self.nodes) - 1

    def build_glb(self, output_path):
        self._align_bin(4)
        
        gltf = {
            "asset": {
                "generator": "NRG Stadium 3D Generator",
                "version": "2.0"
            },
            "scene": 0,
            "scenes": [{
                "name": "StadiumScene",
                "nodes": self.scene_nodes
            }],
            "nodes": self.nodes,
            "materials": self.materials,
            "meshes": self.meshes,
            "accessors": self.accessors,
            "bufferViews": self.buffer_views,
            "buffers": [{
                "byteLength": len(self.bin_data)
            }]
        }

        json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
        json_pad = (4 - (len(json_bytes) % 4)) % 4
        json_bytes += b' ' * json_pad

        bin_pad = (4 - (len(self.bin_data) % 4)) % 4
        self.bin_data.extend(b'\x00' * bin_pad)

        total_length = 12 + 8 + len(json_bytes) + 8 + len(self.bin_data)

        with open(output_path, 'wb') as f:
            # GLB Header
            f.write(struct.pack('<I', 0x46546C67)) # 'glTF'
            f.write(struct.pack('<I', 2))          # version
            f.write(struct.pack('<I', total_length))

            # Chunk 0: JSON
            f.write(struct.pack('<I', len(json_bytes)))
            f.write(struct.pack('<I', 0x4E4F534A)) # 'JSON'
            f.write(json_bytes)

            # Chunk 1: BIN
            f.write(struct.pack('<I', len(self.bin_data)))
            f.write(struct.pack('<I', 0x004E4942)) # 'BIN\0'
            f.write(self.bin_data)

        print(f"Successfully generated GLB ({total_length:,} bytes) -> {output_path}")

print("GLBBuilder helper defined")
