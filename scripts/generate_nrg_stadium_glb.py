import math
import numpy as np
import os
import sys

# Add current directory to path
sys.path.append(os.path.dirname(__file__))
from glb_builder import GLBBuilder

def create_box(builder, name, min_x, min_y, min_z, max_x, max_y, max_z, mat_idx):
    # 8 vertices
    x0, y0, z0 = min_x, min_y, min_z
    x1, y1, z1 = max_x, max_y, max_z

    # 6 faces * 4 vertices = 24 vertices
    positions = [
        # +Y (Top)
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
        # -Y (Bottom)
        [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0],
        # +Z (South / Front)
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
        # -Z (North / Back)
        [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0],
        # +X (East / Right)
        [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1],
        # -X (West / Left)
        [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]
    ]

    normals = [
        [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0],
        [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1],
        [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1],
        [1, 0, 0], [1, 0, 0], [1, 0, 0], [1, 0, 0],
        [-1, 0, 0], [-1, 0, 0], [-1, 0, 0], [-1, 0, 0]
    ]

    indices = []
    for f in range(6):
        base = f * 4
        indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])

    mesh_idx = builder.add_mesh_primitive(name, positions, normals, indices, mat_idx)
    return mesh_idx

def create_superellipse_tier(builder, name, inner_rx, inner_rz, outer_rx, outer_rz, y_base, y_top, mat_idx, steps=72, exponent=3.0, cut_north=False, cut_south=False):
    """
    Creates a rounded rectangular / super-elliptical stadium seating tier.
    """
    positions = []
    normals = []
    indices = []

    # Angular sampling
    thetas = np.linspace(0, 2 * np.pi, steps, endpoint=False)

    def superellipse_pt(rx, rz, theta, p=exponent):
        ct = math.cos(theta)
        st = math.sin(theta)
        s_ct = math.copysign(abs(ct) ** (2.0 / p), ct)
        s_st = math.copysign(abs(st) ** (2.0 / p), st)
        return rx * s_ct, rz * s_st

    # Generate points along ring
    # Stepped profile: 4 steps per tier
    n_steps_rows = 5
    for s in range(n_steps_rows):
        frac_in = s / n_steps_rows
        frac_out = (s + 1) / n_steps_rows
        
        r_x0 = inner_rx + (outer_rx - inner_rx) * frac_in
        r_z0 = inner_rz + (outer_rz - inner_rz) * frac_in
        y0 = y_base + (y_top - y_base) * frac_in

        r_x1 = inner_rx + (outer_rx - inner_rx) * frac_out
        r_z1 = inner_rz + (outer_rz - inner_rz) * frac_out
        y1 = y_base + (y_top - y_base) * frac_out

        for i in range(steps):
            t0 = thetas[i]
            t1 = thetas[(i + 1) % steps]

            x00, z00 = superellipse_pt(r_x0, r_z0, t0)
            x01, z01 = superellipse_pt(r_x0, r_z0, t1)
            x10, z10 = superellipse_pt(r_x1, r_z1, t0)
            x11, z11 = superellipse_pt(r_x1, r_z1, t1)

            # Skip if cutaway for vomitory or entrance
            if cut_north and (math.pi * 0.4 < t0 < math.pi * 0.6):
                continue
            if cut_south and (math.pi * 1.4 < t0 < math.pi * 1.6):
                continue

            # Tread surface (+Y normal)
            base_idx = len(positions)
            positions.extend([
                [x00, y1, z00],
                [x01, y1, z01],
                [x11, y1, z11],
                [x10, y1, z10]
            ])
            normals.extend([[0, 1, 0]] * 4)
            indices.extend([base_idx, base_idx + 1, base_idx + 2, base_idx, base_idx + 2, base_idx + 3])

            # Riser surface (outward facing normal)
            base_idx2 = len(positions)
            positions.extend([
                [x00, y0, z00],
                [x01, y0, z01],
                [x01, y1, z01],
                [x00, y1, z00]
            ])
            # Riser outward normal
            nx = math.cos(t0)
            nz = math.sin(t0)
            normals.extend([[nx, 0, nz]] * 4)
            indices.extend([base_idx2, base_idx2 + 1, base_idx2 + 2, base_idx2, base_idx2 + 2, base_idx2 + 3])

    mesh_idx = builder.add_mesh_primitive(name, positions, normals, indices, mat_idx)
    return mesh_idx

def create_goalpost(builder, name, x_pos, z_pos, z_dir, yellow_mat_idx):
    """
    Creates NFL standard yellow goal post:
    - Base pad
    - Curved gooseneck
    - Crossbar (18.5 ft / 5.6m wide)
    - 2 vertical uprights (35 ft / 10.6m high)
    """
    positions = []
    normals = []
    indices = []

    # Main post
    r = 0.25
    h_post = 3.0
    for dy in range(6):
        y = dy * (h_post / 5)
        # 8 sided cylinder
        pass

    # We can use simple boxes to assemble the robust goalpost
    parts = []
    # Base pad (safety foam)
    p_pad = create_box(builder, f"{name}_pad", x_pos - 0.5, 0, z_pos - 0.5, x_pos + 0.5, 1.8, z_pos + 0.5, yellow_mat_idx)
    # Post
    p_post = create_box(builder, f"{name}_post", x_pos - 0.2, 1.8, z_pos - 0.2, x_pos + 0.2, 3.05, z_pos + 0.2, yellow_mat_idx)
    # Gooseneck arm extending over endline
    arm_z0 = z_pos
    arm_z1 = z_pos + z_dir * 1.8
    minz, maxz = min(arm_z0, arm_z1), max(arm_z0, arm_z1)
    p_arm = create_box(builder, f"{name}_arm", x_pos - 0.15, 2.9, minz, x_pos + 0.15, 3.15, maxz, yellow_mat_idx)
    # Crossbar (5.6m width along X)
    p_cross = create_box(builder, f"{name}_crossbar", x_pos - 2.8, 3.05, arm_z1 - 0.15, x_pos + 2.8, 3.2, arm_z1 + 0.15, yellow_mat_idx)
    # Left upright
    p_up_l = create_box(builder, f"{name}_upright_l", x_pos - 2.85, 3.2, arm_z1 - 0.12, x_pos - 2.7, 12.0, arm_z1 + 0.12, yellow_mat_idx)
    # Right upright
    p_up_r = create_box(builder, f"{name}_upright_r", x_pos + 2.7, 3.2, arm_z1 - 0.12, x_pos + 2.85, 12.0, arm_z1 + 0.12, yellow_mat_idx)

    return [p_pad, p_post, p_arm, p_cross, p_up_l, p_up_r]

def generate_nrg_stadium_glb(output_path):
    builder = GLBBuilder()

    # Define accurate materials
    mat_grass = builder.add_material("Mat_TurfGreen", base_color=(0.14, 0.48, 0.18, 1.0), roughness=0.85, metallic=0.02)
    mat_grass_alt = builder.add_material("Mat_TurfAlternate", base_color=(0.16, 0.52, 0.20, 1.0), roughness=0.85, metallic=0.02)
    mat_white_lines = builder.add_material("Mat_YardLinesWhite", base_color=(0.95, 0.95, 0.95, 1.0), roughness=0.4, metallic=0.1)
    mat_texans_navy = builder.add_material("Mat_TexansNavy", base_color=(0.01, 0.08, 0.24, 1.0), roughness=0.55, metallic=0.15)
    mat_texans_red = builder.add_material("Mat_TexansRed", base_color=(0.79, 0.04, 0.14, 1.0), roughness=0.55, metallic=0.15)
    mat_suites_glass = builder.add_material("Mat_SuitesGlass", base_color=(0.10, 0.18, 0.26, 0.9), roughness=0.15, metallic=0.85)
    mat_concrete = builder.add_material("Mat_ConcreteFacade", base_color=(0.68, 0.70, 0.73, 1.0), roughness=0.75, metallic=0.1)
    mat_steel_dark = builder.add_material("Mat_SteelStructure", base_color=(0.22, 0.25, 0.30, 1.0), roughness=0.45, metallic=0.7)
    mat_steel_light = builder.add_material("Mat_TrussRoof", base_color=(0.85, 0.88, 0.92, 1.0), roughness=0.35, metallic=0.6)
    mat_screen_display = builder.add_material("Mat_ScoreboardScreen", base_color=(0.05, 0.12, 0.25, 1.0), emissive=(0.2, 0.45, 0.85), roughness=0.2, metallic=0.5)
    mat_goalpost = builder.add_material("Mat_GoalPostYellow", base_color=(0.98, 0.78, 0.05, 1.0), roughness=0.3, metallic=0.3)
    
    # Gate sponsor materials
    mat_ford_blue = builder.add_material("Mat_FordGateBlue", base_color=(0.0, 0.24, 0.58, 1.0), roughness=0.3, metallic=0.4)
    mat_kroger_red = builder.add_material("Mat_KrogerGateRed", base_color=(0.85, 0.1, 0.15, 1.0), roughness=0.3, metallic=0.3)
    mat_p66_red = builder.add_material("Mat_Phillips66Gate", base_color=(0.88, 0.15, 0.15, 1.0), roughness=0.3, metallic=0.4)
    mat_xfinity_purple = builder.add_material("Mat_XfinityGate", base_color=(0.55, 0.12, 0.65, 1.0), roughness=0.3, metallic=0.4)

    # 1. FIELD SURFACE & YARD PATTERNS
    # Field: standard 120 yards (109.7m) x 53.3 yards (48.8m)
    field_length = 110.0 # Z axis: -55 to +55
    field_width = 49.0   # X axis: -24.5 to +24.5
    
    # Base field turf
    m_field = create_box(builder, "Field_GrassTurf", -field_width/2, -0.1, -field_length/2, field_width/2, 0.0, field_length/2, mat_grass)
    builder.add_node("Node_Field_GrassTurf", mesh_idx=m_field)

    # 5-yard alternating lawn mowing bands
    num_bands = 20
    band_len = (field_length - 20.0) / num_bands # playing field 100 yds = ~91.4m (-45.7 to +45.7)
    for b in range(num_bands):
        if b % 2 == 1:
            bz0 = -45.0 + b * band_len
            bz1 = bz0 + band_len
            m_band = create_box(builder, f"Field_TurfBand_{b}", -field_width/2 + 0.1, 0.001, bz0, field_width/2 - 0.1, 0.005, bz1, mat_grass_alt)
            builder.add_node(f"Node_TurfBand_{b}", mesh_idx=m_band)

    # Endzones (Texans Deep Navy Blue)
    # North Endzone (Z: -55 to -45)
    m_ez_n = create_box(builder, "Endzone_North_Texans", -field_width/2 + 0.5, 0.006, -55.0, field_width/2 - 0.5, 0.01, -45.0, mat_texans_navy)
    builder.add_node("Node_Endzone_North", mesh_idx=m_ez_n)
    # South Endzone (Z: +45 to +55)
    m_ez_s = create_box(builder, "Endzone_South_Texans", -field_width/2 + 0.5, 0.006, 45.0, field_width/2 - 0.5, 0.01, 55.0, mat_texans_navy)
    builder.add_node("Node_Endzone_South", mesh_idx=m_ez_s)

    # Endzone "TEXANS" Text / Markings (White letter blocks)
    for z_ez, sgn in [(-50.0, 1), (50.0, -1)]:
        # Lettering blocks along width
        for lx in np.linspace(-15, 15, 6):
            m_let = create_box(builder, f"Endzone_Letter_{lx:.0f}_{sgn}", lx - 1.5, 0.011, z_ez - 2.5, lx + 1.5, 0.015, z_ez + 2.5, mat_white_lines)
            builder.add_node(f"Node_EZ_Letter_{lx:.0f}_{sgn}", mesh_idx=m_let)

    # Sidelines and Yard Lines
    # Outer white perimeter
    m_line_w0 = create_box(builder, "Field_Sideline_W", -field_width/2, 0.007, -field_length/2, -field_width/2 + 0.5, 0.012, field_length/2, mat_white_lines)
    m_line_e0 = create_box(builder, "Field_Sideline_E", field_width/2 - 0.5, 0.007, -field_length/2, field_width/2, 0.012, field_length/2, mat_white_lines)
    m_line_n0 = create_box(builder, "Field_Endline_N", -field_width/2, 0.007, -field_length/2, field_width/2, 0.012, -field_length/2 + 0.5, mat_white_lines)
    m_line_s0 = create_box(builder, "Field_Endline_S", -field_width/2, 0.007, field_length/2 - 0.5, field_width/2, 0.012, field_length/2, mat_white_lines)
    builder.add_node("Node_Sideline_W", mesh_idx=m_line_w0)
    builder.add_node("Node_Sideline_E", mesh_idx=m_line_e0)
    builder.add_node("Node_Endline_N", mesh_idx=m_line_n0)
    builder.add_node("Node_Endline_S", mesh_idx=m_line_s0)

    # Major yard lines (every 10 yards from -40 to +40, plus 50 at 0)
    for yl in range(-40, 41, 10):
        z_line = yl * 0.9144 # 1 yard = 0.9144m
        m_yl = create_box(builder, f"YardLine_{yl}", -field_width/2 + 0.5, 0.008, z_line - 0.12, field_width/2 - 0.5, 0.012, z_line + 0.12, mat_white_lines)
        builder.add_node(f"Node_YardLine_{yl}", mesh_idx=m_yl)

    # Midfield Houston Texans Bull Logo (Center Circle & Horns / Star)
    m_logo_base = create_box(builder, "CenterLogo_Navy", -4.5, 0.012, -4.5, 4.5, 0.016, 4.5, mat_texans_navy)
    m_logo_red_horn = create_box(builder, "CenterLogo_RedHorn", 0.5, 0.017, -4.0, 4.2, 0.021, 1.5, mat_texans_red)
    m_logo_white_star = create_box(builder, "CenterLogo_WhiteStar", -3.2, 0.017, -2.5, -0.8, 0.021, -0.2, mat_white_lines)
    builder.add_node("Node_Logo_Base", mesh_idx=m_logo_base)
    builder.add_node("Node_Logo_RedHorn", mesh_idx=m_logo_red_horn)
    builder.add_node("Node_Logo_WhiteStar", mesh_idx=m_logo_white_star)

    # Goalposts (North & South)
    gp_n = create_goalpost(builder, "Goalpost_North", 0, -55.0, -1, mat_goalpost)
    for i, p in enumerate(gp_n):
        builder.add_node(f"Node_GP_N_{i}", mesh_idx=p)
    gp_s = create_goalpost(builder, "Goalpost_South", 0, 55.0, 1, mat_goalpost)
    for i, p in enumerate(gp_s):
        builder.add_node(f"Node_GP_S_{i}", mesh_idx=p)

    # Field Perimeter Wall & Team Benches Area
    m_wall_w = create_box(builder, "FieldWall_West", -field_width/2 - 3.5, 0.0, -field_length/2 - 3.0, -field_width/2 - 3.0, 1.1, field_length/2 + 3.0, mat_texans_navy)
    m_wall_e = create_box(builder, "FieldWall_East", field_width/2 + 3.0, 0.0, -field_length/2 - 3.0, field_width/2 + 3.5, 1.1, field_length/2 + 3.0, mat_texans_navy)
    m_wall_n = create_box(builder, "FieldWall_North", -field_width/2 - 3.5, 0.0, -field_length/2 - 3.5, field_width/2 + 3.5, 1.1, -field_length/2 - 3.0, mat_texans_navy)
    m_wall_s = create_box(builder, "FieldWall_South", -field_width/2 - 3.5, 0.0, field_length/2 + 3.0, field_width/2 + 3.5, 1.1, field_length/2 + 3.5, mat_texans_navy)
    builder.add_node("Node_Wall_W", mesh_idx=m_wall_w)
    builder.add_node("Node_Wall_E", mesh_idx=m_wall_e)
    builder.add_node("Node_Wall_N", mesh_idx=m_wall_n)
    builder.add_node("Node_Wall_S", mesh_idx=m_wall_s)

    # Team Bench covers (Texans sideline & Visiting sideline)
    m_bench_home = create_box(builder, "Bench_Texans_Home", -field_width/2 - 2.8, 0.0, -18.0, -field_width/2 - 0.8, 0.8, 18.0, mat_texans_navy)
    m_bench_away = create_box(builder, "Bench_Visiting_Away", field_width/2 + 0.8, 0.0, -18.0, field_width/2 + 2.8, 0.8, 18.0, mat_concrete)
    builder.add_node("Node_Bench_Home", mesh_idx=m_bench_home)
    builder.add_node("Node_Bench_Away", mesh_idx=m_bench_away)

    # 2. LOWER SEATING BOWL (100 LEVEL - TEXANS DEEP NAVY)
    # Radii in meters from center
    tier1_in_x, tier1_in_z = field_width/2 + 3.5, field_length/2 + 3.5
    tier1_out_x, tier1_out_z = tier1_in_x + 16.0, tier1_in_z + 18.0
    m_tier1 = create_superellipse_tier(builder, "Bowl_100_LowerNavy", tier1_in_x, tier1_in_z, tier1_out_x, tier1_out_z, 1.1, 7.5, mat_texans_navy, steps=96, exponent=2.8)
    builder.add_node("Node_Bowl_100_Lower", mesh_idx=m_tier1)

    # Concourse 1 Ring Walkway
    m_conc1 = create_superellipse_tier(builder, "Concourse_100_Ring", tier1_out_x, tier1_out_z, tier1_out_x + 3.5, tier1_out_z + 3.5, 7.5, 7.5, mat_concrete, steps=96, exponent=2.8)
    builder.add_node("Node_Concourse_100", mesh_idx=m_conc1)

    # 3. CLUB / LOGE LEVEL (200 LEVEL - TEXANS NAVY)
    tier2_in_x, tier2_in_z = tier1_out_x + 3.5, tier1_out_z + 3.5
    tier2_out_x, tier2_out_z = tier2_in_x + 9.0, tier2_in_z + 10.0
    m_tier2 = create_superellipse_tier(builder, "Bowl_200_ClubNavy", tier2_in_x, tier2_in_z, tier2_out_x, tier2_out_z, 8.5, 13.0, mat_texans_navy, steps=96, exponent=2.8)
    builder.add_node("Node_Bowl_200_Club", mesh_idx=m_tier2)

    # Ribbon LED Display Band around Club Facade
    m_ribbon_led = create_superellipse_tier(builder, "Ribbon_LED_Board", tier2_in_x - 0.3, tier2_in_z - 0.3, tier2_in_x, tier2_in_z, 7.8, 8.5, mat_screen_display, steps=96, exponent=2.8)
    builder.add_node("Node_Ribbon_LED", mesh_idx=m_ribbon_led)

    # 4. LUXURY SUITES (300 & 400 LEVELS - GLASS & BALCONIES)
    tier3_in_x, tier3_in_z = tier2_out_x + 1.0, tier2_out_z + 1.0
    tier3_out_x, tier3_out_z = tier3_in_x + 7.0, tier3_in_z + 7.5
    # Suite Level 300
    m_suite300_balcony = create_superellipse_tier(builder, "Suites_300_Balcony", tier3_in_x, tier3_in_z, tier3_in_x + 3.0, tier3_in_z + 3.0, 13.5, 15.5, mat_texans_navy, steps=96, exponent=2.8)
    m_suite300_glass = create_superellipse_tier(builder, "Suites_300_Glass", tier3_in_x + 3.0, tier3_in_z + 3.0, tier3_out_x, tier3_out_z, 15.5, 18.0, mat_suites_glass, steps=96, exponent=2.8)
    builder.add_node("Node_Suites_300_Balcony", mesh_idx=m_suite300_balcony)
    builder.add_node("Node_Suites_300_Glass", mesh_idx=m_suite300_glass)

    # Suite Level 400
    tier4_in_x, tier4_in_z = tier3_out_x + 0.5, tier3_out_z + 0.5
    tier4_out_x, tier4_out_z = tier4_in_x + 6.5, tier4_in_z + 7.0
    m_suite400_balcony = create_superellipse_tier(builder, "Suites_400_Balcony", tier4_in_x, tier4_in_z, tier4_in_x + 2.5, tier4_in_z + 2.5, 18.5, 20.5, mat_texans_navy, steps=96, exponent=2.8)
    m_suite400_glass = create_superellipse_tier(builder, "Suites_400_Glass", tier4_in_x + 2.5, tier4_in_z + 2.5, tier4_out_x, tier4_out_z, 20.5, 23.0, mat_suites_glass, steps=96, exponent=2.8)
    builder.add_node("Node_Suites_400_Balcony", mesh_idx=m_suite400_balcony)
    builder.add_node("Node_Suites_400_Glass", mesh_idx=m_suite400_glass)

    # 5. UPPER SEATING BOWL (500/600 LEVEL - ICONIC TEXANS RED)
    tier5_in_x, tier5_in_z = tier4_out_x + 1.0, tier4_out_z + 1.0
    tier5_out_x, tier5_out_z = tier5_in_x + 20.0, tier5_in_z + 18.0
    m_tier5_red = create_superellipse_tier(builder, "Bowl_500_UpperRed", tier5_in_x, tier5_in_z, tier5_out_x, tier5_out_z, 23.5, 41.0, mat_texans_red, steps=108, exponent=2.6)
    builder.add_node("Node_Bowl_500_UpperRed", mesh_idx=m_tier5_red)

    # Upper concourse rim & facade wall
    m_upper_rim = create_superellipse_tier(builder, "Upper_Concourse_Rim", tier5_out_x, tier5_out_z, tier5_out_x + 4.0, tier5_out_z + 4.0, 41.0, 41.0, mat_concrete, steps=108, exponent=2.6)
    builder.add_node("Node_Upper_Rim", mesh_idx=m_upper_rim)

    # 6. ENDZONE JUMBOTRON VIDEO BOARDS & SCOREBOARDS (NORTH & SOUTH)
    for end_z, dir_s, name_s in [(-tier1_out_z - 12.0, -1, "North_Ford"), (tier1_out_z + 12.0, 1, "South_Kroger")]:
        # Steel support pillars
        p_l = create_box(builder, f"Jumbotron_Pillar_L_{name_s}", -22.0, 12.0, end_z - 1.0, -20.0, 36.0, end_z + 1.0, mat_steel_dark)
        p_r = create_box(builder, f"Jumbotron_Pillar_R_{name_s}", 20.0, 12.0, end_z - 1.0, 22.0, 36.0, end_z + 1.0, mat_steel_dark)
        builder.add_node(f"Node_Jumbo_Pillar_L_{name_s}", mesh_idx=p_l)
        builder.add_node(f"Node_Jumbo_Pillar_R_{name_s}", mesh_idx=p_r)

        # Huge High-Definition Screen
        p_scr = create_box(builder, f"Jumbotron_Screen_{name_s}", -20.0, 20.0, end_z - 0.4, 20.0, 34.0, end_z + 0.4, mat_screen_display)
        builder.add_node(f"Node_Jumbotron_Screen_{name_s}", mesh_idx=p_scr)

        # Screen bezel / housing
        p_frame = create_box(builder, f"Jumbotron_Frame_{name_s}", -21.0, 19.2, end_z - 0.8, 21.0, 35.0, end_z + 0.8, mat_texans_navy)
        builder.add_node(f"Node_Jumbotron_Frame_{name_s}", mesh_idx=p_frame)

    # 7. EXTERIOR FACADE & ARCHITECTURAL GATES (FROM THE PHOTO)
    # Outer Stadium Footprint
    out_w = tier5_out_x + 8.0
    out_l = tier5_out_z + 8.0
    
    # Ground Plaza
    m_ground = create_box(builder, "Plaza_GroundSlab", -out_w - 15, -1.0, -out_l - 15, out_w + 15, 0.0, out_l + 15, mat_concrete)
    builder.add_node("Node_Plaza_Ground", mesh_idx=m_ground)

    # Cutaway Facade Exterior Walls
    # West Exterior Wall (with Phillips 66 Gate)
    m_ext_w = create_box(builder, "Exterior_Wall_West", -out_w, 0.0, -out_l + 10, -out_w + 4.0, 38.0, out_l - 10, mat_concrete)
    m_ext_glass_w = create_box(builder, "Exterior_GlassCurtain_West", -out_w + 1.0, 4.0, -out_l + 18, -out_w + 3.0, 34.0, out_l - 18, mat_suites_glass)
    builder.add_node("Node_Ext_Wall_W", mesh_idx=m_ext_w)
    builder.add_node("Node_Ext_Glass_W", mesh_idx=m_ext_glass_w)

    # East Exterior Wall (with Xfinity Gate)
    m_ext_e = create_box(builder, "Exterior_Wall_East", out_w - 4.0, 0.0, -out_l + 10, out_w, 38.0, out_l - 10, mat_concrete)
    m_ext_glass_e = create_box(builder, "Exterior_GlassCurtain_East", out_w - 3.0, 4.0, -out_l + 18, out_w - 1.0, 34.0, out_l - 18, mat_suites_glass)
    builder.add_node("Node_Ext_Wall_E", mesh_idx=m_ext_e)
    builder.add_node("Node_Ext_Glass_E", mesh_idx=m_ext_glass_e)

    # Four Distinct Gate Towers matching the photo:
    # 1) NORTH: Ford Gate
    g_ford_box = create_box(builder, "Gate_Ford_Tower", -14.0, 0.0, -out_l - 2.0, 14.0, 32.0, -out_l + 4.0, mat_concrete)
    g_ford_sign = create_box(builder, "Gate_Ford_Badge", -10.0, 30.0, -out_l - 2.5, 10.0, 34.5, -out_l - 1.8, mat_ford_blue)
    builder.add_node("Node_Gate_Ford_Tower", mesh_idx=g_ford_box)
    builder.add_node("Node_Gate_Ford_Sign", mesh_idx=g_ford_sign)

    # 2) SOUTH: Kroger Gate
    g_kroger_box = create_box(builder, "Gate_Kroger_Tower", -14.0, 0.0, out_l - 4.0, 14.0, 32.0, out_l + 2.0, mat_concrete)
    g_kroger_sign = create_box(builder, "Gate_Kroger_Badge", -10.0, 30.0, out_l + 1.8, 10.0, 34.5, out_l + 2.5, mat_kroger_red)
    builder.add_node("Node_Gate_Kroger_Tower", mesh_idx=g_kroger_box)
    builder.add_node("Node_Gate_Kroger_Sign", mesh_idx=g_kroger_sign)

    # 3) WEST: Phillips 66 Gate
    g_p66_box = create_box(builder, "Gate_Phillips66_Tower", -out_w - 2.0, 0.0, -12.0, -out_w + 4.0, 30.0, 12.0, mat_concrete)
    g_p66_sign = create_box(builder, "Gate_Phillips66_Badge", -out_w - 2.5, 27.0, -8.0, -out_w - 1.8, 31.5, 8.0, mat_p66_red)
    builder.add_node("Node_Gate_Phillips66_Tower", mesh_idx=g_p66_box)
    builder.add_node("Node_Gate_Phillips66_Sign", mesh_idx=g_p66_sign)

    # 4) EAST: Xfinity Gate
    g_xf_box = create_box(builder, "Gate_Xfinity_Tower", out_w - 4.0, 0.0, -12.0, out_w + 2.0, 30.0, 12.0, mat_concrete)
    g_xf_sign = create_box(builder, "Gate_Xfinity_Badge", out_w + 1.8, 27.0, -8.0, out_w + 2.5, 31.5, 8.0, mat_xfinity_purple)
    builder.add_node("Node_Gate_Xfinity_Tower", mesh_idx=g_xf_box)
    builder.add_node("Node_Gate_Xfinity_Sign", mesh_idx=g_xf_sign)

    # 8. RETRACTABLE ROOF RAILS & STEEL ARCH TRUSSES
    # Two massive longitudinal arch rails spanning the stadium
    for rx_side in [-tier5_out_x - 1.0, tier5_out_x + 1.0]:
        m_rail = create_box(builder, f"Roof_Rail_{rx_side:.0f}", rx_side - 1.2, 40.0, -out_l, rx_side + 1.2, 43.5, out_l, mat_steel_light)
        builder.add_node(f"Node_Roof_Rail_{rx_side:.0f}", mesh_idx=m_rail)

    # Overhead curved roof arches (North & South ends of retractable roof)
    for az, adir in [(-tier5_out_z + 4.0, "North"), (tier5_out_z - 4.0, "South")]:
        m_arch = create_box(builder, f"Roof_TrussArch_{adir}", -out_w + 2.0, 42.5, az - 1.8, out_w - 2.0, 46.0, az + 1.8, mat_steel_light)
        builder.add_node(f"Node_Roof_Arch_{adir}", mesh_idx=m_arch)

    # Set scene roots (all node indices)
    builder.scene_nodes = list(range(len(builder.nodes)))

    # Output file
    builder.build_glb(output_path)
    print(f"NRG Stadium GLB built with {len(builder.nodes)} nodes, {len(builder.meshes)} meshes, {len(builder.materials)} materials.")

if __name__ == "__main__":
    out_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "nrg-stadium.glb")
    generate_nrg_stadium_glb(out_file)
