/* ============================================================
 * DSP_CONTENT — 游戏内容数据（物品 / 配方 / 建筑 / 传送带 / 科技 / 星系 / 行星）
 * 契约：SPEC.md §2。纯数据 + 纯函数，不碰 DOM，不依赖其他文件。
 * 挂载：globalThis.DSP_CONTENT（同时兼容浏览器经典脚本与 Node 冒烟测试）
 * 命名与文案全部原创（通用材料名词除外）。
 * ============================================================ */
(function () {
  'use strict';

  /* ------------------------------------------------------------
   * 物品（78）kind: 'solid' | 'fluid' | 'matrix'
   * category: ore 矿物 / material 基础材料 / component 机械零件 /
   *           chemical 化工品 / electronics 电子 / fuel 燃料 /
   *           dyson 戴森 / logistics 物流 / matrix 科研矩阵
   * ---------------------------------------------------------- */
  const ITEMS = {
    // —— 矿物（15）——
    iron_ore: { id: 'iron_ore', name: '铁矿石', symbol: 'Fe', color: '#496ec3', kind: 'solid', category: 'ore', description: '地壳中最常见的金属矿，一切重工业的起点。' },
    copper_ore: { id: 'copper_ore', name: '铜矿石', symbol: 'Cu', color: '#d28e5e', kind: 'solid', category: 'ore', description: '导电性优异的有色金属矿，电气工业的命脉。' },
    stone: { id: 'stone', name: '石矿', symbol: 'St', color: '#e9cb86', kind: 'solid', category: 'ore', description: '随处可见的沉积岩，烧制建材与玻璃的原料。' },
    coal: { id: 'coal', name: '煤矿', symbol: 'C', color: '#495979', kind: 'solid', category: 'ore', description: '古代植物碳化形成的燃料矿，化工与发电两相宜。' },
    crude_oil: { id: 'crude_oil', name: '原油', symbol: 'Oil', color: '#b8452f', kind: 'fluid', category: 'ore', description: '深埋地下的粘稠烃类混合物，整条化工链的源头。' },
    water: { id: 'water', name: '水', symbol: 'H2O', color: '#6fb3dd', kind: 'fluid', category: 'ore', description: '江河与海洋的基本资源，冷却与合成皆离不开它。' },
    sulfuric_acid: { id: 'sulfuric_acid', name: '硫酸', symbol: 'H2SO4', color: '#8eb936', kind: 'fluid', category: 'ore', description: '强腐蚀性酸液，既见于天然酸海，也可人工合成。' },
    silicon_ore: { id: 'silicon_ore', name: '硅石', symbol: 'Si', color: '#22c27f', kind: 'solid', category: 'ore', description: '半导体工业的基石矿物，提纯后即是芯片的粮食。' },
    titanium_ore: { id: 'titanium_ore', name: '钛矿石', symbol: 'Ti', color: '#8e5fd6', kind: 'solid', category: 'ore', description: '轻质高强度的稀有金属矿，航天结构的首选。' },
    fire_ice: { id: 'fire_ice', name: '可燃冰', symbol: 'FI', color: '#30d7d1', kind: 'solid', category: 'ore', description: '冰晶中封存着天然气的奇异矿物，可直接裂解取能。' },
    kimberlite_ore: { id: 'kimberlite_ore', name: '金伯利矿石', symbol: 'Km', color: '#c5519e', kind: 'solid', category: 'ore', description: '深部火山管道带上来的金刚母岩，天然富含晶核。' },
    fractal_silicon: { id: 'fractal_silicon', name: '分形硅石', symbol: 'Fs', color: '#951fac', kind: 'solid', category: 'ore', description: '晶格呈分形生长的硅矿，一步即可晶格化。' },
    optical_grating_crystal: { id: 'optical_grating_crystal', name: '光栅石', symbol: 'Og', color: '#d5d036', kind: 'solid', category: 'ore', description: '天然衍射光栅晶体，可直接加工成光学部件。' },
    spiniform_stalagmite_crystal: { id: 'spiniform_stalagmite_crystal', name: '刺笋结晶', symbol: 'Ss', color: '#54883a', kind: 'solid', category: 'ore', description: '形如竹笋的中空晶柱，天生适合拉制碳管。' },
    unipolar_magnet: { id: 'unipolar_magnet', name: '单极磁石', symbol: 'Um', color: '#b8bcc8', kind: 'solid', category: 'ore', description: '只有单一磁极的神奇矿物，仅见于强磁场星域。' },

    // —— 基础材料（13）——
    iron_ingot: { id: 'iron_ingot', name: '铁块', symbol: 'Irn', color: '#addbe0', kind: 'solid', category: 'material', description: '最通用的结构金属，几乎所有建筑的骨架。' },
    copper_ingot: { id: 'copper_ingot', name: '铜块', symbol: 'Cpr', color: '#e18b5d', kind: 'solid', category: 'material', description: '延展性极佳的导电材料，线缆与线圈的基础。' },
    magnet: { id: 'magnet', name: '磁铁', symbol: 'Mag', color: '#5991c0', kind: 'solid', category: 'material', description: '永磁体，一切电磁设备的能量之源。' },
    stone_brick: { id: 'stone_brick', name: '石材', symbol: 'Brk', color: '#d7c097', kind: 'solid', category: 'material', description: '耐高温的砌块，窑炉与化工设施的主要建材。' },
    glass: { id: 'glass', name: '玻璃', symbol: 'Gls', color: '#85d1cf', kind: 'solid', category: 'material', description: '透明而坚硬的硅酸盐材料，光学与科研必需。' },
    steel: { id: 'steel', name: '钢材', symbol: 'Stl', color: '#59a7c0', kind: 'solid', category: 'material', description: '铁碳合金，强度远超生铁的重型结构材料。' },
    steel_beam: { id: 'steel_beam', name: '钢架', symbol: 'Bm', color: '#74adca', kind: 'solid', category: 'material', description: '标准化的钢制桁架，大型设施的承力构件。' },
    energetic_graphite: { id: 'energetic_graphite', name: '高能石墨', symbol: 'EG', color: '#7859c0', kind: 'solid', category: 'material', description: '层状高能碳材料，既是燃料也是碳链的起点。' },
    diamond: { id: 'diamond', name: '金刚石', symbol: 'Dia', color: '#a1dcd2', kind: 'solid', category: 'material', description: '碳的坚硬同素异形体，精密工具与光学膜材。' },
    proliferator_mk1: { id: 'proliferator_mk1', name: '增产剂 Mk.I', symbol: 'P1', color: '#8f9872', kind: 'solid', category: 'material', description: '由煤加工的基础喷涂介质，每件提供 12 个喷涂点数。' },
    proliferator_mk2: { id: 'proliferator_mk2', name: '增产剂 Mk.II', symbol: 'P2', color: '#56a58f', kind: 'solid', category: 'material', description: '加入金刚石强化的增产剂，每件提供 24 个喷涂点数。' },
    proliferator_mk3: { id: 'proliferator_mk3', name: '增产剂 Mk.III', symbol: 'P3', color: '#628fba', kind: 'solid', category: 'material', description: '利用碳纳米管稳定喷涂结构，每件提供 60 个喷涂点数。' },
    high_purity_silicon: { id: 'high_purity_silicon', name: '高纯硅块', symbol: 'HP Si', color: '#5cc1b1', kind: 'solid', category: 'material', description: '九个九纯度的硅锭，芯片产业的第一块砖。' },
    crystal_silicon: { id: 'crystal_silicon', name: '晶格硅', symbol: 'CSi', color: '#70c9ac', kind: 'solid', category: 'material', description: '单晶排列的硅材料，信息时代的关键中间体。' },
    titanium_ingot: { id: 'titanium_ingot', name: '钛块', symbol: 'TiI', color: '#8c76cb', kind: 'solid', category: 'material', description: '锻造后的钛锭，轻而强的星际材料。' },
    titanium_alloy: { id: 'titanium_alloy', name: '钛合金', symbol: 'TiA', color: '#8784d1', kind: 'solid', category: 'material', description: '钛钢复合的耐蚀合金，扛得住恒星风的吹袭。' },

    // —— 机械零件（15）——
    gear: { id: 'gear', name: '齿轮', symbol: 'Gr', color: '#d2aa5b', kind: 'solid', category: 'component', description: '机械传动的基本单元，哪里有旋转哪里就有它。' },
    copper_wire: { id: 'copper_wire', name: '铜线', symbol: 'Cw', color: '#e6a37b', kind: 'solid', category: 'component', description: '拉细的铜丝，绕制线圈与印刷电路的原料。' },
    magnetic_coil: { id: 'magnetic_coil', name: '磁线圈', symbol: 'Mc', color: '#dd6d5b', kind: 'solid', category: 'component', description: '铜线绕成的电磁元件，电机与科研都少不了。' },
    circuit_board: { id: 'circuit_board', name: '电路板', symbol: 'Cb', color: '#6ac667', kind: 'solid', category: 'component', description: '蚀刻好走线的基板，自动化设备的神经。' },
    electric_motor: { id: 'electric_motor', name: '电动机', symbol: 'Mot', color: '#59a0c0', kind: 'solid', category: 'component', description: '把电变成旋转的装置，驱动整条产线。' },
    electromagnetic_turbine: { id: 'electromagnetic_turbine', name: '电磁涡轮', symbol: 'Tur', color: '#59bcc0', kind: 'solid', category: 'component', description: '高速旋转的电磁核心，大功率设备的心脏。' },
    super_magnetic_ring: { id: 'super_magnetic_ring', name: '超级磁场环', symbol: 'SMR', color: '#59c0ba', kind: 'solid', category: 'component', description: '约束高能粒子的强磁环，聚变与对撞的关键。' },
    prism: { id: 'prism', name: '棱镜', symbol: 'Prs', color: '#87d2c8', kind: 'solid', category: 'component', description: '折射光线的精密棱镜，光路系统的眼睛。' },
    plasma_exciter: { id: 'plasma_exciter', name: '电浆激发器', symbol: 'PEx', color: '#d78961', kind: 'solid', category: 'component', description: '激发电浆的高频器件，萃取与精炼的动力源。' },
    particle_container: { id: 'particle_container', name: '粒子容器', symbol: 'PCt', color: '#5abfc1', kind: 'solid', category: 'component', description: '约束超高温粒子的特种容器，对撞实验必备。' },
    photon_combiner: { id: 'photon_combiner', name: '光子合并器', symbol: 'PhC', color: '#d8b65f', kind: 'solid', category: 'component', description: '把分散光子整束合流的光学部件。' },
    plane_filter: { id: 'plane_filter', name: '位面过滤器', symbol: 'PFt', color: '#6ba4c7', kind: 'solid', category: 'component', description: '过滤特定频段辐射的精密滤片，量子器件的原料。' },
    particle_broadband: { id: 'particle_broadband', name: '粒子宽带', symbol: 'PBd', color: '#c971c3', kind: 'solid', category: 'component', description: '承载多频信息流的纳米带材，信息矩阵的载体。' },
    strange_matter: { id: 'strange_matter', name: '奇异物质', symbol: 'SMt', color: '#b379cc', kind: 'solid', category: 'component', description: '极端能级下诞生的奇异物质，能轻微扭曲引力。' },
    graviton_lens: { id: 'graviton_lens', name: '引力透镜', symbol: 'GLs', color: '#8cc567', kind: 'solid', category: 'component', description: '聚焦引力子的透镜，可局部折叠空间。' },

    // —— 化工品（10）——
    refined_oil: { id: 'refined_oil', name: '精炼油', symbol: 'RO', color: '#ca9c4e', kind: 'fluid', category: 'chemical', description: '分馏提纯后的轻质油品，化工与塑料的血液。' },
    hydrogen: { id: 'hydrogen', name: '氢', symbol: 'H', color: '#9ad9d6', kind: 'fluid', category: 'chemical', description: '宇宙中最多的元素，聚变与还原反应的主角。' },
    deuterium: { id: 'deuterium', name: '氘', symbol: 'D', color: '#85c8d1', kind: 'fluid', category: 'chemical', description: '氢的重同位素，聚变电站的优质燃料。' },
    plastic: { id: 'plastic', name: '塑料', symbol: 'Pls', color: '#d9c69b', kind: 'solid', category: 'chemical', description: '可塑性强的高分子材料，现代工业的百搭件。' },
    organic_crystal: { id: 'organic_crystal', name: '有机晶体', symbol: 'Org', color: '#69c059', kind: 'solid', category: 'chemical', description: '有序生长的有机晶体，封存着生命的化学密码。' },
    graphene: { id: 'graphene', name: '石墨烯', symbol: 'Gph', color: '#59c0b4', kind: 'solid', category: 'chemical', description: '单原子层的碳膜，又薄又强还导电。' },
    carbon_nanotube: { id: 'carbon_nanotube', name: '碳纳米管', symbol: 'CNT', color: '#5aaac1', kind: 'solid', category: 'chemical', description: '纳米级碳管，抗拉强度是钢材的百倍。' },
    titanium_crystal: { id: 'titanium_crystal', name: '钛晶石', symbol: 'TiC', color: '#b18ed4', kind: 'solid', category: 'chemical', description: '钛与有机晶体的共生晶，结构矩阵的骨架。' },
    titanium_glass: { id: 'titanium_glass', name: '钛化玻璃', symbol: 'TiG', color: '#84d1ca', kind: 'solid', category: 'chemical', description: '掺钛的高强玻璃，透光又抗冲击。' },
    casimir_crystal: { id: 'casimir_crystal', name: '卡西米尔晶体', symbol: 'Cas', color: '#67c6a9', kind: 'solid', category: 'chemical', description: '利用真空涨落储能的量子晶体。' },

    // —— 电子（4）——
    silicon_wafer: { id: 'silicon_wafer', name: '硅晶圆', symbol: 'Wfr', color: '#84d1ba', kind: 'solid', category: 'electronics', description: '切片抛光的高纯硅圆片，芯片的画布。' },
    microcrystalline_component: { id: 'microcrystalline_component', name: '微晶元件', symbol: 'McC', color: '#59c09f', kind: 'solid', category: 'electronics', description: '微米级精度的晶体元件，处理器的积木。' },
    processor: { id: 'processor', name: '处理器', symbol: 'CPU', color: '#59c08d', kind: 'solid', category: 'electronics', description: '每秒万亿次运算的控制核心，物流与科研的大脑。' },
    quantum_chip: { id: 'quantum_chip', name: '量子芯片', symbol: 'QC', color: '#678dc6', kind: 'solid', category: 'electronics', description: '利用量子纠缠运算的终极芯片，算力的天花板。' },

    // —— 燃料（5）——
    hydrogen_fuel_rod: { id: 'hydrogen_fuel_rod', name: '氢燃料棒', symbol: 'HFR', color: '#71bac9', kind: 'solid', category: 'fuel', description: '封装压缩氢的燃烧棒，火电的清洁燃料。' },
    deuteron_fuel_rod: { id: 'deuteron_fuel_rod', name: '氘核燃料棒', symbol: 'DFR', color: '#63bbc4', kind: 'solid', category: 'fuel', description: '氘核聚变燃料棒，能量密度碾压化石燃料。' },
    antimatter: { id: 'antimatter', name: '反物质', symbol: 'AM', color: '#c5aee0', kind: 'fluid', category: 'fuel', description: '与正物质相遇即湮灭释能，终极能源形态。' },
    annihilation_constraint_sphere: { id: 'annihilation_constraint_sphere', name: '湮灭约束球', symbol: 'ACS', color: '#7da4ce', kind: 'solid', category: 'fuel', description: '困住反物质的磁约束球，安全湮灭的前提。' },
    antimatter_fuel_rod: { id: 'antimatter_fuel_rod', name: '反物质燃料棒', symbol: 'AFR', color: '#beaee0', kind: 'solid', category: 'fuel', description: '封装反物质的终极燃料棒，一颗即可点亮一座城。' },

    // —— 戴森（5）——
    solar_sail: { id: 'solar_sail', name: '太阳帆', symbol: 'Sail', color: '#e4c55f', kind: 'solid', category: 'dyson', description: '薄如蝉翼的反射帆，戴森云的基本单元。' },
    critical_photon: { id: 'critical_photon', name: '临界光子', symbol: 'CP', color: '#b2e0ae', kind: 'solid', category: 'dyson', description: '能量密度达到临界的光子团，质能转换的原料。' },
    frame_material: { id: 'frame_material', name: '框架材料', symbol: 'Frm', color: '#69c2c6', kind: 'solid', category: 'dyson', description: '构成戴森球骨架的高强度复合材料。' },
    dyson_sphere_component: { id: 'dyson_sphere_component', name: '戴森球组件', symbol: 'DSC', color: '#6fc9a1', kind: 'solid', category: 'dyson', description: '集骨架、帆面与控制于一体的球体结构件。' },
    small_carrier_rocket: { id: 'small_carrier_rocket', name: '小型运载火箭', symbol: 'Rkt', color: '#d18a58', kind: 'solid', category: 'dyson', description: '把球体组件送入恒星轨道的小型运载火箭。' },

    // —— 物流（5）——
    logistics_drone: { id: 'logistics_drone', name: '物流运输机', symbol: 'Drn', color: '#5ebfc2', kind: 'solid', category: 'logistics', description: '在行星内往返送货的小型飞行器。' },
    logistics_vessel: { id: 'logistics_vessel', name: '物流运输船', symbol: 'Vsl', color: '#d4865d', kind: 'solid', category: 'logistics', description: '跨行星航行的货运飞船，星际贸易的驮马。' },
    space_warper: { id: 'space_warper', name: '空间翘曲器', symbol: 'Wrp', color: '#8a75cb', kind: 'solid', category: 'logistics', description: '制造曲率泡的消耗品，跨星系航行必备。' },
    accumulator: { id: 'accumulator', name: '蓄电器', symbol: 'Acc', color: '#59c0ad', kind: 'solid', category: 'logistics', description: '储存电能的标准单元，可充满后随船运输。' },
    charged_accumulator: { id: 'charged_accumulator', name: '满蓄电器', symbol: 'Acc+', color: '#86d1a0', kind: 'solid', category: 'logistics', description: '充满九十兆焦电能的蓄电器，一座移动的电池。' },

    // —— 科研矩阵（6，红/蓝/黄/紫/绿/白）——
    electromagnetic_matrix: { id: 'electromagnetic_matrix', name: '电磁矩阵', symbol: 'EM', color: '#e25555', kind: 'matrix', category: 'matrix', description: '红色初阶矩阵，凝聚电磁学的研究数据。' },
    energy_matrix: { id: 'energy_matrix', name: '能量矩阵', symbol: 'EnM', color: '#f0b429', kind: 'matrix', category: 'matrix', description: '蓝色二阶矩阵，编码能源与热力学的成果。' },
    structure_matrix: { id: 'structure_matrix', name: '结构矩阵', symbol: 'StM', color: '#e3b341', kind: 'matrix', category: 'matrix', description: '黄色三阶矩阵，记录物质结构的奥秘。' },
    information_matrix: { id: 'information_matrix', name: '信息矩阵', symbol: 'InM', color: '#8b5cf6', kind: 'matrix', category: 'matrix', description: '紫色四阶矩阵，承载海量信息模型。' },
    gravity_matrix: { id: 'gravity_matrix', name: '引力矩阵', symbol: 'GrM', color: '#22b573', kind: 'matrix', category: 'matrix', description: '绿色五阶矩阵，解析时空与引力的本质。' },
    universe_matrix: { id: 'universe_matrix', name: '宇宙矩阵', symbol: 'Uni', color: '#8a9bb5', kind: 'matrix', category: 'matrix', description: '白色终阶矩阵，集五色之大成的宇宙真理。' },
  };

  /* ------------------------------------------------------------
   * 配方（78）duration 单位秒；requiredTechId 为 null 表示开局可用
   * ---------------------------------------------------------- */
  const RECIPES = {
    // —— 熔炉（16）——
    iron_ingot: { id: 'iron_ingot', name: '铁块', buildingId: 'arc_smelter', duration: 1, requiredTechId: null, inputs: [{ itemId: 'iron_ore', amount: 1 }], outputs: [{ itemId: 'iron_ingot', amount: 1 }] },
    copper_ingot: { id: 'copper_ingot', name: '铜块', buildingId: 'arc_smelter', duration: 1, requiredTechId: null, inputs: [{ itemId: 'copper_ore', amount: 1 }], outputs: [{ itemId: 'copper_ingot', amount: 1 }] },
    magnet: { id: 'magnet', name: '磁铁', buildingId: 'arc_smelter', duration: 1.5, requiredTechId: null, inputs: [{ itemId: 'iron_ore', amount: 1 }], outputs: [{ itemId: 'magnet', amount: 1 }] },
    stone_brick: { id: 'stone_brick', name: '石材', buildingId: 'arc_smelter', duration: 1, requiredTechId: null, inputs: [{ itemId: 'stone', amount: 1 }], outputs: [{ itemId: 'stone_brick', amount: 1 }] },
    glass: { id: 'glass', name: '玻璃', buildingId: 'arc_smelter', duration: 2, requiredTechId: 'glass_optics', inputs: [{ itemId: 'stone', amount: 2 }], outputs: [{ itemId: 'glass', amount: 1 }] },
    steel: { id: 'steel', name: '钢材', buildingId: 'arc_smelter', duration: 3, requiredTechId: 'steel_metallurgy', inputs: [{ itemId: 'iron_ingot', amount: 3 }], outputs: [{ itemId: 'steel', amount: 1 }] },
    steel_beam: { id: 'steel_beam', name: '钢架', buildingId: 'arc_smelter', duration: 2, requiredTechId: 'steel_metallurgy', inputs: [{ itemId: 'steel', amount: 2 }], outputs: [{ itemId: 'steel_beam', amount: 1 }] },
    energetic_graphite: { id: 'energetic_graphite', name: '高能石墨', buildingId: 'arc_smelter', duration: 2, requiredTechId: 'energy_matrix', inputs: [{ itemId: 'coal', amount: 2 }], outputs: [{ itemId: 'energetic_graphite', amount: 1 }] },
    diamond: { id: 'diamond', name: '金刚石', buildingId: 'arc_smelter', duration: 2, requiredTechId: 'high_strength_crystal', inputs: [{ itemId: 'energetic_graphite', amount: 1 }], outputs: [{ itemId: 'diamond', amount: 1 }] },
    proliferator_mk1: { id: 'proliferator_mk1', name: '增产剂 Mk.I', buildingId: 'assembler_mk1', duration: 1, requiredTechId: 'proliferator_1', inputs: [{ itemId: 'coal', amount: 1 }], outputs: [{ itemId: 'proliferator_mk1', amount: 1 }] },
    proliferator_mk2: { id: 'proliferator_mk2', name: '增产剂 Mk.II', buildingId: 'assembler_mk1', duration: 2, requiredTechId: 'proliferator_2', inputs: [{ itemId: 'proliferator_mk1', amount: 2 }, { itemId: 'diamond', amount: 1 }], outputs: [{ itemId: 'proliferator_mk2', amount: 1 }] },
    proliferator_mk3: { id: 'proliferator_mk3', name: '增产剂 Mk.III', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'proliferator_3', inputs: [{ itemId: 'proliferator_mk2', amount: 2 }, { itemId: 'carbon_nanotube', amount: 1 }], outputs: [{ itemId: 'proliferator_mk3', amount: 1 }] },
    high_purity_silicon: { id: 'high_purity_silicon', name: '高纯硅块', buildingId: 'arc_smelter', duration: 2, requiredTechId: 'high_strength_crystal', inputs: [{ itemId: 'silicon_ore', amount: 2 }], outputs: [{ itemId: 'high_purity_silicon', amount: 1 }] },
    crystal_silicon: { id: 'crystal_silicon', name: '晶格硅', buildingId: 'arc_smelter', duration: 2, requiredTechId: 'high_strength_crystal', inputs: [{ itemId: 'high_purity_silicon', amount: 1 }], outputs: [{ itemId: 'crystal_silicon', amount: 1 }] },
    titanium_ingot: { id: 'titanium_ingot', name: '钛块', buildingId: 'arc_smelter', duration: 2, requiredTechId: 'high_strength_crystal', inputs: [{ itemId: 'titanium_ore', amount: 2 }], outputs: [{ itemId: 'titanium_ingot', amount: 1 }] },
    silicon_ore_from_stone: { id: 'silicon_ore_from_stone', name: '石矿提硅', buildingId: 'arc_smelter', duration: 10, requiredTechId: 'high_strength_crystal', inputs: [{ itemId: 'stone', amount: 10 }], outputs: [{ itemId: 'silicon_ore', amount: 1 }] },
    titanium_alloy: { id: 'titanium_alloy', name: '钛合金', buildingId: 'arc_smelter', duration: 6, requiredTechId: 'titanium_alloy', inputs: [{ itemId: 'titanium_ingot', amount: 2 }, { itemId: 'steel', amount: 1 }, { itemId: 'sulfuric_acid', amount: 2 }], outputs: [{ itemId: 'titanium_alloy', amount: 2 }] },
    diamond_from_kimberlite: { id: 'diamond_from_kimberlite', name: '金伯利提炼金刚石', buildingId: 'arc_smelter', duration: 1.5, requiredTechId: 'rare_resources', inputs: [{ itemId: 'kimberlite_ore', amount: 1 }], outputs: [{ itemId: 'diamond', amount: 2 }] },
    crystal_silicon_from_fractal: { id: 'crystal_silicon_from_fractal', name: '分形硅晶格化', buildingId: 'arc_smelter', duration: 1.5, requiredTechId: 'rare_resources', inputs: [{ itemId: 'fractal_silicon', amount: 1 }], outputs: [{ itemId: 'crystal_silicon', amount: 2 }] },

    // —— 制造台（36）——
    gear: { id: 'gear', name: '齿轮', buildingId: 'assembler_mk1', duration: 1, requiredTechId: null, inputs: [{ itemId: 'iron_ingot', amount: 1 }], outputs: [{ itemId: 'gear', amount: 1 }] },
    copper_wire: { id: 'copper_wire', name: '铜线', buildingId: 'assembler_mk1', duration: 1, requiredTechId: null, inputs: [{ itemId: 'copper_ingot', amount: 1 }], outputs: [{ itemId: 'copper_wire', amount: 2 }] },
    magnetic_coil: { id: 'magnetic_coil', name: '磁线圈', buildingId: 'assembler_mk1', duration: 1, requiredTechId: null, inputs: [{ itemId: 'magnet', amount: 2 }, { itemId: 'copper_wire', amount: 1 }], outputs: [{ itemId: 'magnetic_coil', amount: 2 }] },
    circuit_board: { id: 'circuit_board', name: '电路板', buildingId: 'assembler_mk1', duration: 1, requiredTechId: null, inputs: [{ itemId: 'iron_ingot', amount: 2 }, { itemId: 'copper_wire', amount: 1 }], outputs: [{ itemId: 'circuit_board', amount: 2 }] },
    electric_motor: { id: 'electric_motor', name: '电动机', buildingId: 'assembler_mk1', duration: 2, requiredTechId: 'motor_drive', inputs: [{ itemId: 'iron_ingot', amount: 2 }, { itemId: 'gear', amount: 1 }, { itemId: 'magnetic_coil', amount: 1 }], outputs: [{ itemId: 'electric_motor', amount: 1 }] },
    electromagnetic_turbine: { id: 'electromagnetic_turbine', name: '电磁涡轮', buildingId: 'assembler_mk1', duration: 2, requiredTechId: 'motor_drive', inputs: [{ itemId: 'electric_motor', amount: 2 }, { itemId: 'magnetic_coil', amount: 2 }], outputs: [{ itemId: 'electromagnetic_turbine', amount: 1 }] },
    super_magnetic_ring: { id: 'super_magnetic_ring', name: '超级磁场环', buildingId: 'assembler_mk1', duration: 3, requiredTechId: 'particle_physics', inputs: [{ itemId: 'electromagnetic_turbine', amount: 2 }, { itemId: 'magnet', amount: 3 }, { itemId: 'energetic_graphite', amount: 1 }], outputs: [{ itemId: 'super_magnetic_ring', amount: 1 }] },
    plasma_exciter: { id: 'plasma_exciter', name: '电浆激发器', buildingId: 'assembler_mk1', duration: 2, requiredTechId: 'glass_optics', inputs: [{ itemId: 'magnetic_coil', amount: 2 }, { itemId: 'prism', amount: 1 }], outputs: [{ itemId: 'plasma_exciter', amount: 1 }] },
    prism: { id: 'prism', name: '棱镜', buildingId: 'assembler_mk1', duration: 2, requiredTechId: 'glass_optics', inputs: [{ itemId: 'glass', amount: 3 }], outputs: [{ itemId: 'prism', amount: 2 }] },
    particle_container: { id: 'particle_container', name: '粒子容器', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'particle_physics', inputs: [{ itemId: 'electromagnetic_turbine', amount: 1 }, { itemId: 'copper_ingot', amount: 2 }, { itemId: 'graphene', amount: 2 }], outputs: [{ itemId: 'particle_container', amount: 1 }] },
    particle_container_from_unipolar: { id: 'particle_container_from_unipolar', name: '单极磁石粒子容器', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'rare_resources', inputs: [{ itemId: 'unipolar_magnet', amount: 10 }, { itemId: 'copper_ingot', amount: 2 }], outputs: [{ itemId: 'particle_container', amount: 1 }] },
    photon_combiner: { id: 'photon_combiner', name: '光子合并器', buildingId: 'assembler_mk1', duration: 3, requiredTechId: 'dyson_swarm', inputs: [{ itemId: 'prism', amount: 2 }, { itemId: 'circuit_board', amount: 1 }], outputs: [{ itemId: 'photon_combiner', amount: 1 }] },
    photon_combiner_from_grating: { id: 'photon_combiner_from_grating', name: '光栅石光子合并器', buildingId: 'assembler_mk1', duration: 3, requiredTechId: 'rare_resources', inputs: [{ itemId: 'optical_grating_crystal', amount: 1 }, { itemId: 'circuit_board', amount: 1 }], outputs: [{ itemId: 'photon_combiner', amount: 1 }] },
    plane_filter: { id: 'plane_filter', name: '位面过滤器', buildingId: 'assembler_mk1', duration: 6, requiredTechId: 'quantum_chips', inputs: [{ itemId: 'casimir_crystal', amount: 1 }, { itemId: 'titanium_glass', amount: 2 }], outputs: [{ itemId: 'plane_filter', amount: 1 }] },
    particle_broadband: { id: 'particle_broadband', name: '粒子宽带', buildingId: 'assembler_mk1', duration: 8, requiredTechId: 'information_matrix', inputs: [{ itemId: 'carbon_nanotube', amount: 2 }, { itemId: 'crystal_silicon', amount: 2 }, { itemId: 'plastic', amount: 1 }], outputs: [{ itemId: 'particle_broadband', amount: 1 }] },
    graviton_lens: { id: 'graviton_lens', name: '引力透镜', buildingId: 'assembler_mk1', duration: 6, requiredTechId: 'exotic_matter', inputs: [{ itemId: 'diamond', amount: 4 }, { itemId: 'strange_matter', amount: 1 }], outputs: [{ itemId: 'graviton_lens', amount: 1 }] },
    logistics_drone: { id: 'logistics_drone', name: '物流运输机', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'planetary_logistics', inputs: [{ itemId: 'steel', amount: 5 }, { itemId: 'processor', amount: 2 }, { itemId: 'electromagnetic_turbine', amount: 2 }], outputs: [{ itemId: 'logistics_drone', amount: 1 }] },
    logistics_vessel: { id: 'logistics_vessel', name: '物流运输船', buildingId: 'assembler_mk1', duration: 8, requiredTechId: 'interstellar_logistics', inputs: [{ itemId: 'titanium_alloy', amount: 4 }, { itemId: 'processor', amount: 4 }, { itemId: 'plasma_exciter', amount: 2 }], outputs: [{ itemId: 'logistics_vessel', amount: 1 }] },
    space_warper: { id: 'space_warper', name: '空间翘曲器', buildingId: 'assembler_mk1', duration: 10, requiredTechId: 'space_warp', inputs: [{ itemId: 'graviton_lens', amount: 1 }], outputs: [{ itemId: 'space_warper', amount: 2 }] },
    accumulator: { id: 'accumulator', name: '蓄电器', buildingId: 'assembler_mk1', duration: 5, requiredTechId: 'energy_storage', inputs: [{ itemId: 'iron_ingot', amount: 6 }, { itemId: 'magnetic_coil', amount: 6 }, { itemId: 'circuit_board', amount: 4 }], outputs: [{ itemId: 'accumulator', amount: 1 }] },
    hydrogen_fuel_rod: { id: 'hydrogen_fuel_rod', name: '氢燃料棒', buildingId: 'assembler_mk1', duration: 6, requiredTechId: 'fractionation', inputs: [{ itemId: 'titanium_ingot', amount: 1 }, { itemId: 'hydrogen', amount: 10 }], outputs: [{ itemId: 'hydrogen_fuel_rod', amount: 2 }] },
    deuteron_fuel_rod: { id: 'deuteron_fuel_rod', name: '氘核燃料棒', buildingId: 'assembler_mk1', duration: 6, requiredTechId: 'deuterium_fuel', inputs: [{ itemId: 'titanium_alloy', amount: 1 }, { itemId: 'deuterium', amount: 20 }, { itemId: 'super_magnetic_ring', amount: 1 }], outputs: [{ itemId: 'deuteron_fuel_rod', amount: 2 }] },
    titanium_glass: { id: 'titanium_glass', name: '钛化玻璃', buildingId: 'assembler_mk1', duration: 5, requiredTechId: 'quantum_chips', inputs: [{ itemId: 'glass', amount: 2 }, { itemId: 'titanium_ingot', amount: 2 }, { itemId: 'water', amount: 2 }], outputs: [{ itemId: 'titanium_glass', amount: 2 }] },
    casimir_crystal: { id: 'casimir_crystal', name: '卡西米尔晶体', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'quantum_chips', inputs: [{ itemId: 'titanium_crystal', amount: 1 }, { itemId: 'graphene', amount: 2 }, { itemId: 'hydrogen', amount: 12 }], outputs: [{ itemId: 'casimir_crystal', amount: 1 }] },
    casimir_crystal_from_grating: { id: 'casimir_crystal_from_grating', name: '光栅石卡西米尔晶体', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'rare_resources', inputs: [{ itemId: 'optical_grating_crystal', amount: 4 }, { itemId: 'graphene', amount: 2 }, { itemId: 'hydrogen', amount: 12 }], outputs: [{ itemId: 'casimir_crystal', amount: 1 }] },
    frame_material: { id: 'frame_material', name: '框架材料', buildingId: 'assembler_mk1', duration: 6, requiredTechId: 'dyson_sphere_program', inputs: [{ itemId: 'carbon_nanotube', amount: 4 }, { itemId: 'titanium_alloy', amount: 1 }, { itemId: 'high_purity_silicon', amount: 1 }], outputs: [{ itemId: 'frame_material', amount: 1 }] },
    dyson_sphere_component: { id: 'dyson_sphere_component', name: '戴森球组件', buildingId: 'assembler_mk1', duration: 8, requiredTechId: 'dyson_sphere_program', inputs: [{ itemId: 'frame_material', amount: 2 }, { itemId: 'solar_sail', amount: 2 }, { itemId: 'processor', amount: 2 }], outputs: [{ itemId: 'dyson_sphere_component', amount: 1 }] },
    small_carrier_rocket: { id: 'small_carrier_rocket', name: '小型运载火箭', buildingId: 'assembler_mk1', duration: 6, requiredTechId: 'vertical_launching', inputs: [{ itemId: 'dyson_sphere_component', amount: 2 }, { itemId: 'deuteron_fuel_rod', amount: 2 }, { itemId: 'quantum_chip', amount: 2 }], outputs: [{ itemId: 'small_carrier_rocket', amount: 1 }] },
    quantum_chip: { id: 'quantum_chip', name: '量子芯片', buildingId: 'assembler_mk1', duration: 6, requiredTechId: 'quantum_chips', inputs: [{ itemId: 'processor', amount: 2 }, { itemId: 'plane_filter', amount: 2 }], outputs: [{ itemId: 'quantum_chip', amount: 1 }] },
    microcrystalline_component: { id: 'microcrystalline_component', name: '微晶元件', buildingId: 'assembler_mk1', duration: 2, requiredTechId: 'semiconductor_process', inputs: [{ itemId: 'silicon_wafer', amount: 2 }, { itemId: 'copper_wire', amount: 1 }], outputs: [{ itemId: 'microcrystalline_component', amount: 1 }] },
    silicon_wafer: { id: 'silicon_wafer', name: '硅晶圆', buildingId: 'assembler_mk1', duration: 2, requiredTechId: 'semiconductor_process', inputs: [{ itemId: 'high_purity_silicon', amount: 2 }], outputs: [{ itemId: 'silicon_wafer', amount: 1 }] },
    processor: { id: 'processor', name: '处理器', buildingId: 'assembler_mk1', duration: 3, requiredTechId: 'processor_tech', inputs: [{ itemId: 'circuit_board', amount: 2 }, { itemId: 'microcrystalline_component', amount: 2 }], outputs: [{ itemId: 'processor', amount: 1 }] },
    titanium_crystal: { id: 'titanium_crystal', name: '钛晶石', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'structure_matrix', inputs: [{ itemId: 'titanium_ingot', amount: 3 }, { itemId: 'organic_crystal', amount: 1 }], outputs: [{ itemId: 'titanium_crystal', amount: 1 }] },
    solar_sail: { id: 'solar_sail', name: '太阳帆', buildingId: 'assembler_mk1', duration: 4, requiredTechId: 'dyson_swarm', inputs: [{ itemId: 'graphene', amount: 1 }, { itemId: 'photon_combiner', amount: 1 }], outputs: [{ itemId: 'solar_sail', amount: 2 }] },
    annihilation_constraint_sphere: { id: 'annihilation_constraint_sphere', name: '湮灭约束球', buildingId: 'assembler_mk1', duration: 10, requiredTechId: 'antimatter_tech', inputs: [{ itemId: 'particle_container', amount: 1 }, { itemId: 'processor', amount: 1 }], outputs: [{ itemId: 'annihilation_constraint_sphere', amount: 1 }] },
    antimatter_fuel_rod: { id: 'antimatter_fuel_rod', name: '反物质燃料棒', buildingId: 'assembler_mk1', duration: 12, requiredTechId: 'antimatter_tech', inputs: [{ itemId: 'antimatter', amount: 10 }, { itemId: 'hydrogen', amount: 10 }, { itemId: 'annihilation_constraint_sphere', amount: 1 }, { itemId: 'titanium_alloy', amount: 1 }], outputs: [{ itemId: 'antimatter_fuel_rod', amount: 2 }] },

    // —— 粒子对撞机（2）——
    strange_matter: { id: 'strange_matter', name: '奇异物质', buildingId: 'particle_collider', duration: 8, requiredTechId: 'exotic_matter', inputs: [{ itemId: 'particle_container', amount: 2 }, { itemId: 'iron_ingot', amount: 2 }, { itemId: 'deuterium', amount: 10 }], outputs: [{ itemId: 'strange_matter', amount: 1 }] },
    antimatter: { id: 'antimatter', name: '质能转换', buildingId: 'particle_collider', duration: 2, requiredTechId: 'antimatter_tech', inputs: [{ itemId: 'critical_photon', amount: 2 }], outputs: [{ itemId: 'hydrogen', amount: 2 }, { itemId: 'antimatter', amount: 1 }] },

    // —— 分馏塔（1）——
    deuterium_fractionation: { id: 'deuterium_fractionation', name: '氢分馏', buildingId: 'fractionator', duration: 1, requiredTechId: 'fractionation', inputs: [{ itemId: 'hydrogen', amount: 10 }], outputs: [{ itemId: 'hydrogen', amount: 9 }, { itemId: 'deuterium', amount: 1 }] },

    // —— 原油精炼厂（3）——
    plasma_refining: { id: 'plasma_refining', name: '等离子精炼', buildingId: 'oil_refinery', duration: 4, requiredTechId: 'plasma_refining', inputs: [{ itemId: 'crude_oil', amount: 2 }], outputs: [{ itemId: 'refined_oil', amount: 2 }, { itemId: 'hydrogen', amount: 1 }] },
    xray_cracking: { id: 'xray_cracking', name: 'X 射线裂解', buildingId: 'oil_refinery', duration: 4, requiredTechId: 'xray_cracking', inputs: [{ itemId: 'refined_oil', amount: 2 }, { itemId: 'hydrogen', amount: 1 }], outputs: [{ itemId: 'energetic_graphite', amount: 1 }, { itemId: 'hydrogen', amount: 3 }] },
    reforming_refine: { id: 'reforming_refine', name: '重整精炼', buildingId: 'oil_refinery', duration: 4, requiredTechId: 'polymer_chemistry', inputs: [{ itemId: 'crude_oil', amount: 1 }, { itemId: 'coal', amount: 1 }, { itemId: 'hydrogen', amount: 1 }], outputs: [{ itemId: 'refined_oil', amount: 3 }] },

    // —— 催化精炼厂（1）——
    catalytic_cracking: { id: 'catalytic_cracking', name: '催化裂化', buildingId: 'catalytic_refiner', duration: 4, requiredTechId: 'catalytic_refining', inputs: [{ itemId: 'crude_oil', amount: 3 }, { itemId: 'hydrogen', amount: 2 }], outputs: [{ itemId: 'refined_oil', amount: 5 }] },

    // —— 化工厂（8）——
    plastic: { id: 'plastic', name: '塑料', buildingId: 'chemical_plant', duration: 3, requiredTechId: 'basic_chemistry', inputs: [{ itemId: 'refined_oil', amount: 2 }, { itemId: 'energetic_graphite', amount: 1 }], outputs: [{ itemId: 'plastic', amount: 1 }] },
    sulfuric_acid_synth: { id: 'sulfuric_acid_synth', name: '硫酸合成', buildingId: 'chemical_plant', duration: 6, requiredTechId: 'basic_chemistry', inputs: [{ itemId: 'refined_oil', amount: 3 }, { itemId: 'stone', amount: 4 }, { itemId: 'water', amount: 2 }], outputs: [{ itemId: 'sulfuric_acid', amount: 4 }] },
    graphene: { id: 'graphene', name: '石墨烯', buildingId: 'chemical_plant', duration: 3, requiredTechId: 'nanomaterials', inputs: [{ itemId: 'energetic_graphite', amount: 3 }, { itemId: 'sulfuric_acid', amount: 1 }], outputs: [{ itemId: 'graphene', amount: 2 }] },
    graphene_from_fire_ice: { id: 'graphene_from_fire_ice', name: '可燃冰裂解', buildingId: 'chemical_plant', duration: 2, requiredTechId: 'rare_resources', inputs: [{ itemId: 'fire_ice', amount: 2 }], outputs: [{ itemId: 'graphene', amount: 2 }, { itemId: 'hydrogen', amount: 1 }] },
    carbon_nanotube: { id: 'carbon_nanotube', name: '碳纳米管', buildingId: 'chemical_plant', duration: 4, requiredTechId: 'nanomaterials', inputs: [{ itemId: 'graphene', amount: 3 }, { itemId: 'titanium_ingot', amount: 1 }], outputs: [{ itemId: 'carbon_nanotube', amount: 2 }] },
    carbon_nanotube_from_spiniform: { id: 'carbon_nanotube_from_spiniform', name: '刺笋结晶拉管', buildingId: 'chemical_plant', duration: 4, requiredTechId: 'rare_resources', inputs: [{ itemId: 'spiniform_stalagmite_crystal', amount: 6 }], outputs: [{ itemId: 'carbon_nanotube', amount: 2 }] },
    organic_crystal: { id: 'organic_crystal', name: '有机晶体', buildingId: 'chemical_plant', duration: 6, requiredTechId: 'polymer_chemistry', inputs: [{ itemId: 'plastic', amount: 2 }, { itemId: 'refined_oil', amount: 1 }, { itemId: 'water', amount: 1 }], outputs: [{ itemId: 'organic_crystal', amount: 1 }] },
    water_gas_shift: { id: 'water_gas_shift', name: '水煤气转化', buildingId: 'chemical_plant', duration: 3, requiredTechId: 'basic_chemistry', inputs: [{ itemId: 'coal', amount: 1 }, { itemId: 'water', amount: 2 }], outputs: [{ itemId: 'hydrogen', amount: 3 }] },

    // —— 矩阵研究站（6）——
    electromagnetic_matrix: { id: 'electromagnetic_matrix', name: '电磁矩阵', buildingId: 'matrix_lab', duration: 3, requiredTechId: null, inputs: [{ itemId: 'magnetic_coil', amount: 1 }, { itemId: 'circuit_board', amount: 1 }], outputs: [{ itemId: 'electromagnetic_matrix', amount: 1 }] },
    energy_matrix: { id: 'energy_matrix', name: '能量矩阵', buildingId: 'matrix_lab', duration: 6, requiredTechId: 'energy_matrix', inputs: [{ itemId: 'energetic_graphite', amount: 2 }, { itemId: 'hydrogen', amount: 2 }], outputs: [{ itemId: 'energy_matrix', amount: 1 }] },
    structure_matrix: { id: 'structure_matrix', name: '结构矩阵', buildingId: 'matrix_lab', duration: 8, requiredTechId: 'structure_matrix', inputs: [{ itemId: 'diamond', amount: 1 }, { itemId: 'titanium_crystal', amount: 1 }], outputs: [{ itemId: 'structure_matrix', amount: 1 }] },
    information_matrix: { id: 'information_matrix', name: '信息矩阵', buildingId: 'matrix_lab', duration: 10, requiredTechId: 'information_matrix', inputs: [{ itemId: 'particle_broadband', amount: 1 }, { itemId: 'processor', amount: 2 }], outputs: [{ itemId: 'information_matrix', amount: 1 }] },
    gravity_matrix: { id: 'gravity_matrix', name: '引力矩阵', buildingId: 'matrix_lab', duration: 12, requiredTechId: 'gravity_matrix', inputs: [{ itemId: 'graviton_lens', amount: 1 }, { itemId: 'quantum_chip', amount: 1 }], outputs: [{ itemId: 'gravity_matrix', amount: 2 }] },
    universe_matrix: { id: 'universe_matrix', name: '宇宙矩阵', buildingId: 'matrix_lab', duration: 12, requiredTechId: 'universe_matrix', inputs: [{ itemId: 'electromagnetic_matrix', amount: 1 }, { itemId: 'energy_matrix', amount: 1 }, { itemId: 'structure_matrix', amount: 1 }, { itemId: 'information_matrix', amount: 1 }, { itemId: 'gravity_matrix', amount: 1 }, { itemId: 'antimatter', amount: 1 }], outputs: [{ itemId: 'universe_matrix', amount: 2 }] },

    // —— 射线接收站（1）——
    critical_photon: { id: 'critical_photon', name: '临界光子', buildingId: 'ray_receiver', duration: 10, requiredTechId: 'ray_receiver_tech', inputs: [], outputs: [{ itemId: 'critical_photon', amount: 1 }] },

    // —— 电磁轨道弹射器（1）——
    solar_sail_launch: { id: 'solar_sail_launch', name: '太阳帆发射', buildingId: 'em_rail_ejector', duration: 12, requiredTechId: 'dyson_swarm', inputs: [{ itemId: 'solar_sail', amount: 1 }], outputs: [] },

    // —— 垂直发射井（1）——
    carrier_rocket_launch: { id: 'carrier_rocket_launch', name: '运载火箭发射', buildingId: 'launching_silo', duration: 6, requiredTechId: 'vertical_launching', inputs: [{ itemId: 'small_carrier_rocket', amount: 1 }], outputs: [] },

    // —— 能量枢纽（2）——
    accumulator_charge: { id: 'accumulator_charge', name: '蓄电器充电', buildingId: 'energy_hub', duration: 2, requiredTechId: 'energy_storage', inputs: [{ itemId: 'accumulator', amount: 1 }], outputs: [{ itemId: 'charged_accumulator', amount: 1 }] },
    accumulator_discharge: { id: 'accumulator_discharge', name: '蓄电器放电', buildingId: 'energy_hub', duration: 2, requiredTechId: 'energy_storage', inputs: [{ itemId: 'charged_accumulator', amount: 1 }], outputs: [{ itemId: 'accumulator', amount: 1 }] },
  };

  /* ------------------------------------------------------------
   * 建筑（37）kind: miner | machine | lab | power | storage | station | splitter | dyson
   * w/h 为世界单位；speed 为配方速度倍率；techId 为解锁科技
   * ---------------------------------------------------------- */
  const BUILDINGS = {
    // —— 采矿（3）——
    mining_machine: { id: 'mining_machine', name: '采矿机', shortName: '采矿机', icon: '⛏️', color: '#c49654', kind: 'miner', family: null, tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 420, powerGenerationKw: 0, inputCapacity: 0, outputCapacity: 180, techId: null, description: '安放在矿脉上持续开采矿石，是最早的自动化劳力。' },
    oil_extractor: { id: 'oil_extractor', name: '原油萃取站', shortName: '萃取站', icon: '🛢️', color: '#c09559', kind: 'miner', family: null, tier: 2, w: 80, h: 80, speed: 1, powerDemandKw: 840, powerGenerationKw: 0, inputCapacity: 0, outputCapacity: 300, techId: 'fluid_handling', description: '立在油泉之上把原油源源不断地抽上地面。' },
    water_pump: { id: 'water_pump', name: '抽水站', shortName: '抽水站', icon: '💧', color: '#599bc0', kind: 'miner', family: null, tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 300, powerGenerationKw: 0, inputCapacity: 0, outputCapacity: 300, techId: 'fluid_handling', description: '部署在水源边抽取水与酸液，化工产线的起点。' },
    advanced_miner: { id: 'advanced_miner', name: '深层采矿机', shortName: '深采机', icon: '🦾', color: '#cd9d4c', kind: 'miner', family: null, tier: 2, w: 80, h: 80, speed: 2, powerDemandKw: 1050, powerGenerationKw: 0, inputCapacity: 0, outputCapacity: 360, techId: 'advanced_mining', description: '以两倍速率深挖矿脉核心，中后期采矿的主力。' },

    // —— 熔炉（2）——
    arc_smelter: { id: 'arc_smelter', name: '电弧熔炉', shortName: '熔炉', icon: '🔥', color: '#c9774f', kind: 'machine', family: 'smelter', tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 360, powerGenerationKw: 0, inputCapacity: 120, outputCapacity: 120, techId: null, description: '用电弧熔炼矿石与煤，冶金链的起点。' },
    plane_smelter: { id: 'plane_smelter', name: '位面熔炉', shortName: '位面炉', icon: '🌡️', color: '#d25747', kind: 'machine', family: 'smelter', tier: 2, w: 80, h: 80, speed: 2, powerDemandKw: 1440, powerGenerationKw: 0, inputCapacity: 240, outputCapacity: 240, techId: 'plane_smelting', description: '磁约束等离子腔体，以双倍速度处理全部熔炼配方。' },

    // —— 制造台（3）——
    assembler_mk1: { id: 'assembler_mk1', name: '制造台 Mk.I', shortName: '制造台I', icon: '🔧', color: '#5993c0', kind: 'machine', family: 'assembler', tier: 1, w: 80, h: 80, speed: 0.75, powerDemandKw: 270, powerGenerationKw: 0, inputCapacity: 120, outputCapacity: 120, techId: null, description: '以 0.75 倍配方速度组装基础零件的通用工作台。' },
    spray_coater: { id: 'spray_coater', name: '喷涂机', shortName: '喷涂机', icon: '💨', color: '#7fae8f', kind: 'machine', family: null, tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 90, powerGenerationKw: 0, inputCapacity: 0, outputCapacity: 0, techId: 'proliferator_1', description: '可绑定到一台生产机器的内联喷涂模块：增产模式额外产出，加速模式提速增耗。' },
    assembler_mk2: { id: 'assembler_mk2', name: '制造台 Mk.II', shortName: '制造台II', icon: '⚙️', color: '#59a6c0', kind: 'machine', family: 'assembler', tier: 2, w: 80, h: 80, speed: 1, powerDemandKw: 540, powerGenerationKw: 0, inputCapacity: 180, outputCapacity: 180, techId: 'high_speed_assembling', description: '标准速度的进阶装配平台，同样的占地更高的吞吐。' },
    assembler_mk3: { id: 'assembler_mk3', name: '制造台 Mk.III', shortName: '制造台III', icon: '🛠️', color: '#4fb2c9', kind: 'machine', family: 'assembler', tier: 3, w: 80, h: 80, speed: 1.5, powerDemandKw: 1080, powerGenerationKw: 0, inputCapacity: 240, outputCapacity: 240, techId: 'quantum_assembling', description: '量子级精密装配，以 1.5 倍速度消化一切制造配方。' },

    // —— 研究站（2，kind=lab，产物自动汇入科研库存）——
    matrix_lab: { id: 'matrix_lab', name: '矩阵研究站', shortName: '研究站', icon: '🔬', color: '#7669c6', kind: 'lab', family: null, tier: 1, w: 100, h: 100, speed: 1, powerDemandKw: 480, powerGenerationKw: 0, inputCapacity: 120, outputCapacity: 120, techId: null, description: '把原料炼成科研矩阵，成果直接汇入研究库存。' },
    quantum_lab: { id: 'quantum_lab', name: '量子研究站', shortName: '量子站', icon: '🔭', color: '#8f5dc2', kind: 'lab', family: null, tier: 2, w: 100, h: 100, speed: 2, powerDemandKw: 960, powerGenerationKw: 0, inputCapacity: 240, outputCapacity: 240, techId: 'quantum_lab_tech', description: '以量子演算并行推进实验，矩阵产出速度翻倍。' },

    // —— 化工 / 精炼 / 分馏 / 对撞（8）——
    chemical_plant: { id: 'chemical_plant', name: '化工厂', shortName: '化工厂', icon: '⚗️', color: '#59c090', kind: 'machine', family: 'chemical', tier: 1, w: 120, h: 80, speed: 1, powerDemandKw: 720, powerGenerationKw: 0, inputCapacity: 240, outputCapacity: 240, techId: 'basic_chemistry', description: '执行塑料、晶体与酸液等高分子化工配方。' },
    quantum_chemical_plant: { id: 'quantum_chemical_plant', name: '量子化工厂', shortName: '量子化工', icon: '🧪', color: '#53c59c', kind: 'machine', family: 'chemical', tier: 2, w: 120, h: 100, speed: 2, powerDemandKw: 2160, powerGenerationKw: 0, inputCapacity: 480, outputCapacity: 480, techId: 'quantum_chemical', description: '量子芯片控制的高压反应腔，化工速度提升至两倍。' },
    oil_refinery: { id: 'oil_refinery', name: '原油精炼厂', shortName: '精炼厂', icon: '⛽', color: '#c09b58', kind: 'machine', family: 'refinery', tier: 1, w: 120, h: 80, speed: 1, powerDemandKw: 960, powerGenerationKw: 0, inputCapacity: 240, outputCapacity: 240, techId: 'fluid_handling', description: '把原油分裂成油品与氢气，也能反向重组碳链。' },
    catalytic_refiner: { id: 'catalytic_refiner', name: '催化精炼厂', shortName: '催化厂', icon: '🧫', color: '#c5a653', kind: 'machine', family: 'refinery', tier: 2, w: 120, h: 80, speed: 2, powerDemandKw: 1440, powerGenerationKw: 0, inputCapacity: 360, outputCapacity: 360, techId: 'catalytic_refining', description: '催化剂让每一滴原油都物尽其用，精炼效率翻倍。' },
    fractionator: { id: 'fractionator', name: '分馏塔', shortName: '分馏塔', icon: '🗼', color: '#c0c059', kind: 'machine', family: 'fractionator', tier: 1, w: 80, h: 120, speed: 1, powerDemandKw: 720, powerGenerationKw: 0, inputCapacity: 240, outputCapacity: 240, techId: 'fractionation', description: '让氢反复穿塔而行，稳定分离出珍贵的氘。' },
    particle_collider: { id: 'particle_collider', name: '粒子对撞机', shortName: '对撞机', icon: '💫', color: '#8659c0', kind: 'machine', family: 'collider', tier: 1, w: 120, h: 120, speed: 1, powerDemandKw: 12000, powerGenerationKw: 0, inputCapacity: 600, outputCapacity: 600, techId: 'particle_physics', description: '耗电巨兽，在极端能级下孕育奇异物质与反物质。' },
    heavy_collider: { id: 'heavy_collider', name: '重型对撞机', shortName: '重对撞', icon: '💥', color: '#b059c0', kind: 'machine', family: 'collider', tier: 2, w: 160, h: 120, speed: 2, powerDemandKw: 24000, powerGenerationKw: 0, inputCapacity: 900, outputCapacity: 900, techId: 'heavy_colliders', description: '环形超导加速器，以双倍速率量产高能粒子产物。' },
    ray_receiver: { id: 'ray_receiver', name: '射线接收站', shortName: '接收站', icon: '🔆', color: '#c6b152', kind: 'machine', family: 'receiver', tier: 1, w: 100, h: 100, speed: 1, powerDemandKw: 0, powerGenerationKw: 0, inputCapacity: 0, outputCapacity: 120, techId: 'ray_receiver_tech', description: '借助戴森云汇聚恒星能凝结出临界光子，能量来自戴森云，不占用行星电网。' },

    // —— 电力（6 + 1 光子电站 = 7）——
    wind_turbine: { id: 'wind_turbine', name: '风力涡轮机', shortName: '风机', icon: '🌬️', color: '#6ca9c7', kind: 'power', family: null, tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 0, powerGenerationKw: 300, inputCapacity: 0, outputCapacity: 0, techId: null, description: '零燃料的基础电源，利用行星大气稳定送出三百千瓦。' },
    solar_panel: { id: 'solar_panel', name: '太阳能板', shortName: '太阳能', icon: '☀️', color: '#d4b84f', kind: 'power', family: null, tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 0, powerGenerationKw: 360, inputCapacity: 0, outputCapacity: 0, techId: 'solar_energy', description: '无燃料发电，出力随行星日照系数浮动。' },
    thermal_power_plant: { id: 'thermal_power_plant', name: '火力发电厂', shortName: '火电厂', icon: '♨️', color: '#c07e59', kind: 'power', family: null, tier: 1, w: 120, h: 80, speed: 1, powerDemandKw: 0, powerGenerationKw: 2160, inputCapacity: 120, outputCapacity: 0, techId: 'thermal_power', fuel: { itemId: 'coal', options: ['coal', 'fire_ice', 'crude_oil', 'refined_oil', 'energetic_graphite', 'hydrogen', 'hydrogen_fuel_rod'], energyMj: { coal: 2.7, fire_ice: 4.8, crude_oil: 4, refined_oil: 4.4, energetic_graphite: 6.3, hydrogen: 8, hydrogen_fuel_rod: 54 } }, description: '可燃烧煤、可燃冰、原油、精炼油、高能石墨、氢或氢燃料棒发电；燃料能量越高烧得越久（燃耗 = 发电功率 ÷ 燃料能量）。' },
    geothermal_plant: { id: 'geothermal_plant', name: '地热发电站', shortName: '地热站', icon: '🌋', color: '#c9644f', kind: 'power', family: null, tier: 2, w: 100, h: 100, speed: 1, powerDemandKw: 0, powerGenerationKw: 4800, inputCapacity: 0, outputCapacity: 0, techId: 'geothermal_power', description: '钻入熔岩地幔取热，不受昼夜与天气影响的基荷电源。' },
    fusion_plant: { id: 'fusion_plant', name: '微型聚变发电站', shortName: '聚变站', icon: '⚛️', color: '#56c3b3', kind: 'power', family: null, tier: 2, w: 120, h: 100, speed: 1, powerDemandKw: 0, powerGenerationKw: 15000, inputCapacity: 120, outputCapacity: 0, techId: 'fusion_power', fuel: { itemId: 'deuteron_fuel_rod', burnRate: 0.1, energyMj: { deuteron_fuel_rod: 600 } }, description: '点燃氘核燃料的恒星之火，十五兆瓦澎湃输出，需持续供给燃料棒。' },
    artificial_star: { id: 'artificial_star', name: '人造恒星', shortName: '人造星', icon: '🌟', color: '#e0c04f', kind: 'power', family: null, tier: 3, w: 100, h: 100, speed: 1, powerDemandKw: 0, powerGenerationKw: 72000, inputCapacity: 30, outputCapacity: 0, techId: 'artificial_star_tech', fuel: { itemId: 'antimatter_fuel_rod', burnRate: 0.1, energyMj: { antimatter_fuel_rod: 7200 } }, description: '在强磁场里养一颗小恒星，七十二兆瓦的终极电站，以反物质燃料棒为食。' },
    orbital_mirror: { id: 'orbital_mirror', name: '光子发电站', shortName: '光子站', icon: '🪞', color: '#d0d06f', kind: 'power', family: null, tier: 3, w: 100, h: 100, speed: 1, powerDemandKw: 0, powerGenerationKw: 24000, inputCapacity: 0, outputCapacity: 0, techId: 'photon_power', description: '把戴森云反射的恒星光聚焦成电，日产二十四兆瓦。' },

    // —— 储存（3）——
    storage_mk1: { id: 'storage_mk1', name: '小型储物仓', shortName: '储物仓', icon: '📦', color: '#c0a559', kind: 'storage', family: null, tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 0, powerGenerationKw: 0, inputCapacity: 600, outputCapacity: 600, techId: 'basic_logistics', description: '缓存固体物资并向后续线路持续供货。' },
    storage_tank: { id: 'storage_tank', name: '储液罐', shortName: '储液罐', icon: '🏺', color: '#59c0ad', kind: 'storage', family: null, tier: 1, w: 80, h: 80, speed: 1, powerDemandKw: 0, powerGenerationKw: 0, inputCapacity: 1200, outputCapacity: 1200, techId: 'fluid_handling', description: '缓存原油、油品、氢与氘等流体资源。' },
    storage_mk2: { id: 'storage_mk2', name: '量子储物仓', shortName: '量子仓', icon: '🗃️', color: '#7659c0', kind: 'storage', family: null, tier: 2, w: 120, h: 120, speed: 1, powerDemandKw: 0, powerGenerationKw: 0, inputCapacity: 3000, outputCapacity: 3000, techId: 'quantum_storage', description: '用空间折叠技术装下五倍货物的超级仓库。' },

    // —— 物流站（4）——
    planetary_station: { id: 'planetary_station', name: '行星物流站', shortName: '行星站', icon: '📡', color: '#59a5c0', kind: 'station', family: null, tier: 1, w: 120, h: 120, speed: 1, powerDemandKw: 600, powerGenerationKw: 0, inputCapacity: 600, outputCapacity: 600, techId: 'planetary_logistics', description: '调度物流运输机，让物资无视距离在行星内穿梭。' },
    interstellar_station: { id: 'interstellar_station', name: '星际物流站', shortName: '星际站', icon: '🛰️', color: '#5898c0', kind: 'station', family: null, tier: 2, w: 120, h: 120, speed: 1, powerDemandKw: 1200, powerGenerationKw: 0, inputCapacity: 1000, outputCapacity: 1000, techId: 'interstellar_logistics', description: '派出运输船跨行星送货，星区贸易网络的节点。' },
    orbital_collector: { id: 'orbital_collector', name: '轨道采集器', shortName: '轨道采集', icon: '🌀', color: '#608ec3', kind: 'station', family: null, tier: 2, w: 120, h: 120, speed: 1, powerDemandKw: 0, powerGenerationKw: 0, inputCapacity: 0, outputCapacity: 2000, techId: 'interstellar_logistics', description: '悬浮在气态巨星云层之上，采集氢与可燃冰。' },
    orbital_freight_terminal: { id: 'orbital_freight_terminal', name: '轨道货运码头', shortName: '货运码头', icon: '🚢', color: '#5888c0', kind: 'station', family: null, tier: 3, w: 140, h: 140, speed: 1, powerDemandKw: 12000, powerGenerationKw: 0, inputCapacity: 5000, outputCapacity: 5000, techId: 'orbital_freight', description: '星系级的巨型中转港，吞吐量是普通星际站的数倍。' },

    // —— 分流（1）——
    splitter: { id: 'splitter', name: '四向分流器', shortName: '分流器', icon: '🔀', color: '#a3c059', kind: 'splitter', family: null, tier: 1, w: 80, h: 80, speed: 1.5, powerDemandKw: 0, powerGenerationKw: 0, inputCapacity: 60, outputCapacity: 60, techId: 'basic_logistics', description: '把一股物流均匀分往多个方向，产线疏堵神器。' },

    // —— 戴森（2，kind=dyson）——
    em_rail_ejector: { id: 'em_rail_ejector', name: '电磁轨道弹射器', shortName: '弹射器', icon: '🏹', color: '#c5a253', kind: 'dyson', family: null, tier: 1, w: 120, h: 80, speed: 1, powerDemandKw: 1800, powerGenerationKw: 0, inputCapacity: 180, outputCapacity: 0, techId: 'dyson_swarm', description: '沿电磁轨道把太阳帆精准抛入恒星轨道。' },
    launching_silo: { id: 'launching_silo', name: '垂直发射井', shortName: '发射井', icon: '🚀', color: '#c58253', kind: 'dyson', family: null, tier: 2, w: 100, h: 140, speed: 1, powerDemandKw: 18000, powerGenerationKw: 0, inputCapacity: 180, outputCapacity: 0, techId: 'vertical_launching', description: '把运载火箭直送太空，为戴森球浇筑永久结构。' },

    // —— 能量枢纽（machine/energy）——
    energy_hub: { id: 'energy_hub', name: '能量枢纽', shortName: '能量枢纽', icon: '🔋', color: '#59c0a3', kind: 'machine', family: 'energy', tier: 2, w: 100, h: 100, speed: 1, powerDemandKw: 0, powerGenerationKw: 45000, powerChargeKw: 45000, inputCapacity: 120, outputCapacity: 120, techId: 'energy_storage', description: '充电模式以 45 兆瓦给蓄电器充电，放电模式以 45 兆瓦向电网供电；充/放电与对应配方绑定，把电变成可运输的货。' },
  };

  /* ------------------------------------------------------------
   * 建造成本（参照 DSPONLINE CONSTRUCTION 数组，映射到本作建筑 ID）
   * 每项 costs: [{ itemId, amount }]；placeBuilding 时检查 state.stock 并扣除
   * ---------------------------------------------------------- */
  var BUILDING_COSTS = {
    // 采矿
    mining_machine: [{ itemId: 'iron_ingot', amount: 4 }, { itemId: 'circuit_board', amount: 2 }, { itemId: 'magnetic_coil', amount: 2 }, { itemId: 'gear', amount: 2 }],
    oil_extractor: [{ itemId: 'steel', amount: 12 }, { itemId: 'stone_brick', amount: 12 }, { itemId: 'circuit_board', amount: 6 }, { itemId: 'plasma_exciter', amount: 4 }],
    spray_coater: [{ itemId: 'steel', amount: 4 }, { itemId: 'circuit_board', amount: 4 }, { itemId: 'plasma_exciter', amount: 2 }],
    water_pump: [{ itemId: 'iron_ingot', amount: 4 }, { itemId: 'stone_brick', amount: 8 }, { itemId: 'circuit_board', amount: 2 }, { itemId: 'magnetic_coil', amount: 2 }],
    advanced_miner: [{ itemId: 'steel', amount: 8 }, { itemId: 'circuit_board', amount: 4 }, { itemId: 'magnetic_coil', amount: 4 }, { itemId: 'gear', amount: 4 }],
    // 熔炉
    arc_smelter: [{ itemId: 'iron_ingot', amount: 4 }, { itemId: 'stone_brick', amount: 2 }, { itemId: 'circuit_board', amount: 4 }, { itemId: 'magnetic_coil', amount: 2 }],
    plane_smelter: [{ itemId: 'titanium_alloy', amount: 15 }, { itemId: 'processor', amount: 8 }, { itemId: 'super_magnetic_ring', amount: 4 }, { itemId: 'plane_filter', amount: 4 }],
    // 制造台
    assembler_mk1: [{ itemId: 'iron_ingot', amount: 4 }, { itemId: 'gear', amount: 8 }, { itemId: 'circuit_board', amount: 4 }],
    assembler_mk2: [{ itemId: 'steel', amount: 8 }, { itemId: 'gear', amount: 8 }, { itemId: 'circuit_board', amount: 8 }, { itemId: 'magnetic_coil', amount: 4 }],
    assembler_mk3: [{ itemId: 'titanium_alloy', amount: 8 }, { itemId: 'particle_broadband', amount: 8 }, { itemId: 'quantum_chip', amount: 4 }],
    // 研究站
    matrix_lab: [{ itemId: 'iron_ingot', amount: 8 }, { itemId: 'glass', amount: 4 }, { itemId: 'circuit_board', amount: 4 }, { itemId: 'magnetic_coil', amount: 4 }],
    quantum_lab: [{ itemId: 'titanium_alloy', amount: 10 }, { itemId: 'processor', amount: 8 }, { itemId: 'quantum_chip', amount: 4 }, { itemId: 'particle_broadband', amount: 4 }],
    // 化工 / 精炼 / 分馏 / 对撞
    chemical_plant: [{ itemId: 'steel', amount: 8 }, { itemId: 'stone_brick', amount: 8 }, { itemId: 'glass', amount: 8 }, { itemId: 'circuit_board', amount: 4 }],
    quantum_chemical_plant: [{ itemId: 'titanium_alloy', amount: 10 }, { itemId: 'graphene', amount: 20 }, { itemId: 'processor', amount: 10 }, { itemId: 'plane_filter', amount: 4 }],
    oil_refinery: [{ itemId: 'steel', amount: 10 }, { itemId: 'stone_brick', amount: 10 }, { itemId: 'circuit_board', amount: 6 }, { itemId: 'plasma_exciter', amount: 6 }],
    catalytic_refiner: [{ itemId: 'titanium_alloy', amount: 12 }, { itemId: 'processor', amount: 8 }, { itemId: 'plane_filter', amount: 4 }, { itemId: 'graphene', amount: 8 }],
    fractionator: [{ itemId: 'steel', amount: 8 }, { itemId: 'stone_brick', amount: 4 }, { itemId: 'glass', amount: 4 }, { itemId: 'processor', amount: 1 }],
    particle_collider: [{ itemId: 'titanium_alloy', amount: 20 }, { itemId: 'processor', amount: 20 }, { itemId: 'super_magnetic_ring', amount: 20 }, { itemId: 'graphene', amount: 20 }],
    heavy_collider: [{ itemId: 'titanium_alloy', amount: 30 }, { itemId: 'processor', amount: 30 }, { itemId: 'super_magnetic_ring', amount: 30 }, { itemId: 'strange_matter', amount: 10 }],
    ray_receiver: [{ itemId: 'steel', amount: 20 }, { itemId: 'high_purity_silicon', amount: 20 }, { itemId: 'photon_combiner', amount: 10 }, { itemId: 'processor', amount: 5 }],
    // 电力
    wind_turbine: [{ itemId: 'iron_ingot', amount: 6 }, { itemId: 'gear', amount: 1 }, { itemId: 'magnetic_coil', amount: 3 }],
    solar_panel: [{ itemId: 'copper_ingot', amount: 10 }, { itemId: 'high_purity_silicon', amount: 10 }, { itemId: 'circuit_board', amount: 5 }],
    thermal_power_plant: [{ itemId: 'iron_ingot', amount: 10 }, { itemId: 'stone_brick', amount: 4 }, { itemId: 'gear', amount: 4 }, { itemId: 'magnetic_coil', amount: 4 }],
    geothermal_plant: [{ itemId: 'steel', amount: 15 }, { itemId: 'titanium_alloy', amount: 8 }, { itemId: 'processor', amount: 4 }],
    fusion_plant: [{ itemId: 'titanium_alloy', amount: 12 }, { itemId: 'super_magnetic_ring', amount: 10 }, { itemId: 'carbon_nanotube', amount: 8 }, { itemId: 'processor', amount: 4 }],
    artificial_star: [{ itemId: 'titanium_alloy', amount: 20 }, { itemId: 'frame_material', amount: 20 }, { itemId: 'annihilation_constraint_sphere', amount: 10 }, { itemId: 'quantum_chip', amount: 10 }],
    orbital_mirror: [{ itemId: 'titanium_alloy', amount: 10 }, { itemId: 'photon_combiner', amount: 10 }, { itemId: 'critical_photon', amount: 5 }, { itemId: 'processor', amount: 5 }],
    // 储存
    storage_mk1: [{ itemId: 'iron_ingot', amount: 4 }, { itemId: 'stone_brick', amount: 4 }],
    storage_tank: [{ itemId: 'iron_ingot', amount: 8 }, { itemId: 'stone_brick', amount: 4 }, { itemId: 'glass', amount: 4 }],
    storage_mk2: [{ itemId: 'titanium_alloy', amount: 10 }, { itemId: 'quantum_chip', amount: 4 }, { itemId: 'particle_container', amount: 4 }],
    // 物流站
    planetary_station: [{ itemId: 'steel', amount: 20 }, { itemId: 'titanium_ingot', amount: 20 }, { itemId: 'processor', amount: 10 }],
    interstellar_station: [{ itemId: 'steel', amount: 30 }, { itemId: 'titanium_alloy', amount: 40 }, { itemId: 'processor', amount: 20 }],
    orbital_collector: [{ itemId: 'titanium_alloy', amount: 40 }, { itemId: 'super_magnetic_ring', amount: 20 }, { itemId: 'graphene', amount: 20 }],
    orbital_freight_terminal: [{ itemId: 'titanium_alloy', amount: 50 }, { itemId: 'frame_material', amount: 20 }, { itemId: 'quantum_chip', amount: 20 }, { itemId: 'processor', amount: 50 }],
    // 分流
    splitter: [{ itemId: 'iron_ingot', amount: 3 }, { itemId: 'gear', amount: 2 }, { itemId: 'circuit_board', amount: 1 }],
    // 戴森
    em_rail_ejector: [{ itemId: 'steel', amount: 20 }, { itemId: 'gear', amount: 20 }, { itemId: 'processor', amount: 5 }, { itemId: 'super_magnetic_ring', amount: 10 }],
    launching_silo: [{ itemId: 'steel', amount: 80 }, { itemId: 'titanium_alloy', amount: 80 }, { itemId: 'frame_material', amount: 30 }, { itemId: 'graviton_lens', amount: 20 }, { itemId: 'quantum_chip', amount: 10 }],
    // 能量枢纽
    energy_hub: [{ itemId: 'steel', amount: 40 }, { itemId: 'titanium_alloy', amount: 40 }, { itemId: 'processor', amount: 40 }, { itemId: 'particle_container', amount: 8 }],
  };
  // 将成本合并到建筑定义
  (function () {
    for (var bk in BUILDING_COSTS) {
      if (BUILDINGS[bk]) BUILDINGS[bk].costs = BUILDING_COSTS[bk];
    }
  })();

  /* 传送带（3 级）——不算建筑 */
  const BELTS = [
    { tier: 1, speed: 6, name: '基础传送带' },
    { tier: 2, speed: 12, name: '高速传送带' },
    { tier: 3, speed: 30, name: '超磁传送带' },
  ];

  /* ------------------------------------------------------------
   * 科技（67）tier 0-6；costs 主要消耗对应阶矩阵
   * （红=电磁 蓝=能量 黄=结构 紫=信息 绿=引力 白=宇宙）
   * ---------------------------------------------------------- */
  const TECHNOLOGIES = {
    // —— tier 0（3）——
    electromagnetism: { id: 'electromagnetism', name: '电磁起步', tier: 0, costs: [{ itemId: 'electromagnetic_matrix', amount: 5 }], prerequisites: [], summary: '把散落的作坊整合为连续化电磁工业，为后续全部科技奠基。', unlocks: ['风力涡轮机制造'] },
    basic_logistics: { id: 'basic_logistics', name: '基础物流', tier: 1, costs: [{ itemId: 'electromagnetic_matrix', amount: 8 }], prerequisites: ['electromagnetism'], summary: '让物资沿着标准化线路自动流动。', unlocks: ['传送带 Mk.I 制造', '小型储物仓', '四向分流器', '电动机'] },
    magnetic_assembly: { id: 'magnetic_assembly', name: '磁性组件', tier: 1, costs: [{ itemId: 'electromagnetic_matrix', amount: 8 }], prerequisites: ['electromagnetism'], summary: '把磁线圈与电路板升级为标准化磁性组件产线。', unlocks: ['磁线圈 / 电路板量产工艺', '磁性系科技前置'] },

    // —— tier 1（8）——
    steel_metallurgy: { id: 'steel_metallurgy', name: '钢铁冶金', tier: 2, costs: [{ itemId: 'electromagnetic_matrix', amount: 15 }], prerequisites: ['basic_logistics'], summary: '高温碳还原让铁获得脱胎换骨的强度。', unlocks: ['钢材', '钢架'] },
    glass_optics: { id: 'glass_optics', name: '光学玻璃', tier: 2, costs: [{ itemId: 'electromagnetic_matrix', amount: 15 }], prerequisites: ['basic_logistics'], summary: '熔炼透明硅酸盐并磨制精密棱镜。', unlocks: ['玻璃', '棱镜', '电浆激发器'] },
    thermal_power: { id: 'thermal_power', name: '火力发电', tier: 1, costs: [{ itemId: 'electromagnetic_matrix', amount: 8 }], prerequisites: ['electromagnetism'], summary: '燃烧化石燃料换取可调度的可靠电力。', unlocks: ['火力发电厂', '多燃料发电', '按需燃烧'] },
    fluid_handling: { id: 'fluid_handling', name: '流体萃取', tier: 1, costs: [{ itemId: 'electromagnetic_matrix', amount: 14 }], prerequisites: ['electromagnetism'], summary: '建起抽水、采油与精炼的整套流体设施。', unlocks: ['抽水站', '原油萃取站', '原油精炼厂', '储液罐'] },
    plasma_refining: { id: 'plasma_refining', name: '等离子精炼', tier: 2, costs: [{ itemId: 'electromagnetic_matrix', amount: 20 }], prerequisites: ['fluid_handling'], summary: '用电浆把原油劈成油品与氢气。', unlocks: ['等离子精炼配方'] },
    solar_energy: { id: 'solar_energy', name: '太阳能收集', tier: 1, costs: [{ itemId: 'electromagnetic_matrix', amount: 8 }], prerequisites: ['electromagnetism'], summary: '把恒星的馈赠直接接入电网。', unlocks: ['太阳能板', '行星日照系数'] },
    energy_matrix: { id: 'energy_matrix', name: '能量矩阵', tier: 2, costs: [{ itemId: 'electromagnetic_matrix', amount: 15 }], prerequisites: ['thermal_power', 'magnetic_assembly'], summary: '把氢的能级与高能石墨编码为蓝色科研矩阵。', unlocks: ['高能石墨', '能量矩阵生产', '红色矩阵科研'] },
    motor_drive: { id: 'motor_drive', name: '电动机械', tier: 2, costs: [{ itemId: 'electromagnetic_matrix', amount: 12 }, { itemId: 'energy_matrix', amount: 6 }], prerequisites: ['basic_logistics', 'magnetic_assembly'], summary: '从电动机到电磁涡轮，让机器自己动起来。', unlocks: ['电动机', '电磁涡轮', '高速传送带'] },

    // —— tier 2（10）——
    high_strength_crystal: { id: 'high_strength_crystal', name: '高强度晶体', tier: 3, costs: [{ itemId: 'electromagnetic_matrix', amount: 10 }, { itemId: 'energy_matrix', amount: 10 }], prerequisites: ['energy_matrix'], summary: '硅、钛与碳在高温下重排为精密晶体。', unlocks: ['高纯硅块', '钛块', '金刚石', '石矿提炼硅石'] },
    basic_chemistry: { id: 'basic_chemistry', name: '基础化工', tier: 2, costs: [{ itemId: 'energy_matrix', amount: 18 }], prerequisites: ['fluid_handling'], summary: '建立反应釜与管路系统，合成第一种高分子。', unlocks: ['化工厂', '塑料', '硫酸合成', '水煤气转化'] },
    polymer_chemistry: { id: 'polymer_chemistry', name: '高分子化工', tier: 3, costs: [{ itemId: 'electromagnetic_matrix', amount: 15 }, { itemId: 'energy_matrix', amount: 15 }], prerequisites: ['basic_chemistry'], summary: '让碳链按设计生长为有机晶体。', unlocks: ['有机晶体配方'] },
    structure_matrix: { id: 'structure_matrix', name: '结构矩阵', tier: 4, costs: [{ itemId: 'electromagnetic_matrix', amount: 20 }, { itemId: 'energy_matrix', amount: 20 }], prerequisites: ['high_strength_crystal', 'polymer_chemistry'], summary: '以钛晶石与金刚石编码物质结构，点亮黄色矩阵。', unlocks: ['钛晶石', '结构矩阵生产', '黄色矩阵科研'] },
    semiconductor_process: { id: 'semiconductor_process', name: '半导体工艺', tier: 4, costs: [{ itemId: 'energy_matrix', amount: 14 }, { itemId: 'structure_matrix', amount: 12 }], prerequisites: ['high_strength_crystal'], summary: '从硅锭到晶圆，踏入微观制造的大门。', unlocks: ['硅晶圆', '微晶元件'] },
    processor_tech: { id: 'processor_tech', name: '处理器架构', tier: 5, costs: [{ itemId: 'energy_matrix', amount: 16 }, { itemId: 'structure_matrix', amount: 14 }], prerequisites: ['semiconductor_process'], summary: '把百万晶体管集成进一颗控制核心。', unlocks: ['处理器'] },
    planetary_logistics: { id: 'planetary_logistics', name: '行星物流', tier: 6, costs: [{ itemId: 'electromagnetic_matrix', amount: 10 }, { itemId: 'energy_matrix', amount: 10 }, { itemId: 'structure_matrix', amount: 10 }], prerequisites: ['motor_drive', 'processor_tech'], summary: '让运输机取代长长的传送带走廊。', unlocks: ['行星物流站', '物流运输机', '同星球无线运输'] },
    energy_storage: { id: 'energy_storage', name: '能量储存', tier: 3, costs: [{ itemId: 'electromagnetic_matrix', amount: 15 }, { itemId: 'energy_matrix', amount: 15 }], prerequisites: ['energy_matrix', 'basic_logistics'], summary: '把富余电力封进蓄电器，电能从此可以运输。', unlocks: ['蓄电器', '能量枢纽', '满蓄电器', '自动削峰填谷'] },
    fractionation: { id: 'fractionation', name: '流体分馏', tier: 3, costs: [{ itemId: 'electromagnetic_matrix', amount: 15 }, { itemId: 'energy_matrix', amount: 15 }], prerequisites: ['fluid_handling', 'energy_matrix'], summary: '在闭环气流中富集氘，并封装便于运输的氢棒。', unlocks: ['分馏塔', '氢分馏', '氢燃料棒'] },
    geothermal_power: { id: 'geothermal_power', name: '地热发电', tier: 4, costs: [{ itemId: 'electromagnetic_matrix', amount: 18 }, { itemId: 'energy_matrix', amount: 18 }], prerequisites: ['thermal_power', 'energy_storage'], summary: '向行星深处的熔岩借热。', unlocks: ['地热发电站', '烬原 II 熔岩电力'] },

    // —— tier 3（13）——
    xray_cracking: { id: 'xray_cracking', name: 'X 射线裂解', tier: 3, costs: [{ itemId: 'electromagnetic_matrix', amount: 10 }, { itemId: 'energy_matrix', amount: 10 }], prerequisites: ['energy_matrix'], summary: '用高能射线重排油品的碳氢比例。', unlocks: ['X 射线裂解配方', '氢与石墨替代路线'] },
    titanium_alloy: { id: 'titanium_alloy', name: '钛合金', tier: 5, costs: [{ itemId: 'electromagnetic_matrix', amount: 20 }, { itemId: 'energy_matrix', amount: 20 }, { itemId: 'structure_matrix', amount: 10 }], prerequisites: ['structure_matrix'], summary: '硫酸浴锻造出扛得住星际环境的结构材料。', unlocks: ['硫酸合成', '钛合金配方', '熔岩星硫酸海洋开采'] },
    nanomaterials: { id: 'nanomaterials', name: '纳米材料', tier: 6, costs: [{ itemId: 'electromagnetic_matrix', amount: 20 }, { itemId: 'energy_matrix', amount: 20 }, { itemId: 'structure_matrix', amount: 20 }], prerequisites: ['titanium_alloy', 'basic_chemistry'], summary: '把碳材料推进到纳米尺度。', unlocks: ['石墨烯', '碳纳米管', '晶格硅'] },
    information_matrix: { id: 'information_matrix', name: '信息矩阵', tier: 8, costs: [{ itemId: 'electromagnetic_matrix', amount: 26 }, { itemId: 'energy_matrix', amount: 26 }, { itemId: 'structure_matrix', amount: 26 }], prerequisites: ['interstellar_logistics', 'nanomaterials'], summary: '把粒子宽带与处理器编码为紫色科研矩阵。', unlocks: ['粒子宽带', '信息矩阵生产', '紫色矩阵科研'] },
    proliferator_3: { id: 'proliferator_3', name: '增产剂 Mk.III', tier: 9, costs: [{ itemId: 'electromagnetic_matrix', amount: 30 }, { itemId: 'energy_matrix', amount: 30 }, { itemId: 'structure_matrix', amount: 30 }, { itemId: 'information_matrix', amount: 30 }], prerequisites: ['information_matrix', 'nanomaterials', 'proliferator_2'], summary: '以碳纳米管维持高密度喷涂结构，获得最高增产与生产加速效果。', unlocks: ['增产剂 Mk.III', '额外产出 +25%', '生产加速 +100%'] },
    quantum_chips: { id: 'quantum_chips', name: '量子芯片', tier: 9, costs: [{ itemId: 'structure_matrix', amount: 20 }, { itemId: 'information_matrix', amount: 15 }], prerequisites: ['information_matrix'], summary: '从钛化玻璃到量子芯片的完整光电子链。', unlocks: ['钛化玻璃', '卡西米尔晶体', '位面过滤器', '量子芯片'] },
    quantum_lab_tech: { id: 'quantum_lab_tech', name: '量子研究', tier: 9, costs: [{ itemId: 'structure_matrix', amount: 15 }, { itemId: 'information_matrix', amount: 15 }], prerequisites: ['information_matrix'], summary: '用量子演算加速所有科研产出。', unlocks: ['量子研究站'] },
    particle_physics: { id: 'particle_physics', name: '粒子物理', tier: 5, costs: [{ itemId: 'structure_matrix', amount: 24 }, { itemId: 'information_matrix', amount: 15 }], prerequisites: ['structure_matrix', 'energy_storage'], summary: '建造对撞机，触碰物质最深处的秘密。', unlocks: ['粒子对撞机', '超级磁场环', '粒子容器'] },
    deuterium_fuel: { id: 'deuterium_fuel', name: '氘核燃料', tier: 6, costs: [{ itemId: 'structure_matrix', amount: 20 }, { itemId: 'information_matrix', amount: 15 }], prerequisites: ['particle_physics', 'fractionation'], summary: '把氘封装成聚变电站的口粮。', unlocks: ['氘核燃料棒'] },
    interstellar_logistics: { id: 'interstellar_logistics', name: '星际物流', tier: 7, costs: [{ itemId: 'electromagnetic_matrix', amount: 20 }, { itemId: 'energy_matrix', amount: 20 }], prerequisites: ['planetary_logistics', 'energy_storage'], summary: '跨行星航线与轨道采集网络由此展开。', unlocks: ['烬原 II 与苍穹 III', '星际物流站', '物流运输船', '跨行星跳转与运输调度'] },
    stellar_exploration: { id: 'stellar_exploration', name: '恒星勘探', tier: 8, costs: [{ itemId: 'electromagnetic_matrix', amount: 29 }, { itemId: 'energy_matrix', amount: 29 }, { itemId: 'structure_matrix', amount: 29 }, { itemId: 'information_matrix', amount: 29 }, { itemId: 'gravity_matrix', amount: 29 }], prerequisites: ['interstellar_logistics'], summary: '校准导航阵列，为远航绘制第一张星图。', unlocks: ['星图', '北冕座勘探', '赫卡忒中子星系勘探'] },
    rare_resources: { id: 'rare_resources', name: '稀有资源利用', tier: 9, costs: [{ itemId: 'structure_matrix', amount: 24 }, { itemId: 'information_matrix', amount: 26 }], prerequisites: ['stellar_exploration'], summary: '识别六种稀有矿的天然结构，直接跳过冗长工序。', unlocks: ['可燃冰裂解', '金伯利提炼金刚石', '分形硅晶格化', '光栅石光学配方', '刺笋结晶拉管', '单极磁石粒子容器'] },
    high_speed_assembling: { id: 'high_speed_assembling', name: '高速装配', tier: 3, costs: [{ itemId: 'electromagnetic_matrix', amount: 15 }, { itemId: 'energy_matrix', amount: 15 }], prerequisites: ['energy_matrix'], summary: '改进定位机构，让装配线跑满配方速度。', unlocks: ['制造台 Mk.II', '制造台原地升级'] },
    proliferator_1: { id: 'proliferator_1', name: '增产剂 Mk.I', tier: 4, costs: [{ itemId: 'electromagnetic_matrix', amount: 20 }, { itemId: 'energy_matrix', amount: 20 }], prerequisites: ['energy_matrix', 'high_speed_assembling'], summary: '将煤加工为可控喷涂介质，并建立生产节点的内联喷涂模块。', unlocks: ['增产剂 Mk.I', '喷涂机', '额外产出与加速模式'] },
    proliferator_2: { id: 'proliferator_2', name: '增产剂 Mk.II', tier: 5, costs: [{ itemId: 'electromagnetic_matrix', amount: 25 }, { itemId: 'energy_matrix', amount: 25 }, { itemId: 'structure_matrix', amount: 20 }], prerequisites: ['structure_matrix', 'high_strength_crystal', 'proliferator_1'], summary: '利用金刚石稳定喷涂颗粒，在更高耗电下提升增产或加速收益。', unlocks: ['增产剂 Mk.II', '额外产出 +20%', '生产加速 +50%'] },
    advanced_mining: { id: 'advanced_mining', name: '深层采矿', tier: 7, costs: [{ itemId: 'structure_matrix', amount: 20 }, { itemId: 'information_matrix', amount: 15 }], prerequisites: ['structure_matrix', 'planetary_logistics'], summary: '向下再挖十公里，矿脉深层意外地肥沃。', unlocks: ['深层采矿机', '采矿效率 +50%'] },

    // —— tier 4（14）——
    plane_smelting: { id: 'plane_smelting', name: '位面冶金', tier: 6, costs: [{ itemId: 'electromagnetic_matrix', amount: 26 }, { itemId: 'energy_matrix', amount: 26 }, { itemId: 'structure_matrix', amount: 26 }, { itemId: 'information_matrix', amount: 26 }], prerequisites: ['particle_physics', 'high_strength_crystal'], summary: '磁约束等离子腔让冶金速度翻倍。', unlocks: ['位面熔炉', '熔炉原地升级', '熔炼速度 2.00×'] },
    fusion_power: { id: 'fusion_power', name: '可控聚变', tier: 7, costs: [{ itemId: 'electromagnetic_matrix', amount: 29 }, { itemId: 'energy_matrix', amount: 29 }, { itemId: 'structure_matrix', amount: 29 }, { itemId: 'information_matrix', amount: 29 }], prerequisites: ['deuterium_fuel', 'energy_storage'], summary: '把恒星的心脏装进反应堆。', unlocks: ['微型聚变发电站', '15 MW 聚变电力'] },
    quantum_chemical: { id: 'quantum_chemical', name: '量子化工', tier: 10, costs: [{ itemId: 'information_matrix', amount: 24 }, { itemId: 'gravity_matrix', amount: 15 }], prerequisites: ['quantum_chips', 'basic_chemistry'], summary: '量子芯片接管反应腔的全部控制权。', unlocks: ['量子化工厂'] },
    gravity_matrix: { id: 'gravity_matrix', name: '引力矩阵', tier: 10, costs: [{ itemId: 'electromagnetic_matrix', amount: 29 }, { itemId: 'energy_matrix', amount: 29 }, { itemId: 'structure_matrix', amount: 29 }, { itemId: 'information_matrix', amount: 29 }], prerequisites: ['quantum_chips', 'particle_physics'], summary: '解析时空曲率，点亮绿色科研矩阵。', unlocks: ['引力矩阵生产', '绿色矩阵科研'] },
    exotic_matter: { id: 'exotic_matter', name: '奇异物质', tier: 11, costs: [{ itemId: 'structure_matrix', amount: 20 }, { itemId: 'information_matrix', amount: 30 }], prerequisites: ['particle_physics', 'gravity_matrix'], summary: '在对撞机里制造不该存在的物质。', unlocks: ['奇异物质', '引力透镜'] },
    space_warp: { id: 'space_warp', name: '空间翘曲', tier: 11, costs: [{ itemId: 'electromagnetic_matrix', amount: 26 }, { itemId: 'energy_matrix', amount: 26 }, { itemId: 'structure_matrix', amount: 26 }, { itemId: 'information_matrix', amount: 26 }, { itemId: 'gravity_matrix', amount: 26 }], prerequisites: ['gravity_matrix', 'interstellar_logistics'], summary: '折叠空间本身，让船跑得比光快一点点。', unlocks: ['空间翘曲器', '星际站翘曲器仓', '跨恒星航线准备'] },
    dyson_swarm: { id: 'dyson_swarm', name: '戴森云', tier: 11, costs: [{ itemId: 'electromagnetic_matrix', amount: 32 }, { itemId: 'energy_matrix', amount: 32 }, { itemId: 'structure_matrix', amount: 32 }, { itemId: 'information_matrix', amount: 32 }, { itemId: 'gravity_matrix', amount: 32 }], prerequisites: ['gravity_matrix'], summary: '向恒星轨道发射第一片太阳帆。', unlocks: ['光子合并器', '太阳帆', '电磁轨道弹射器', '戴森云发电'] },
    ray_receiver_tech: { id: 'ray_receiver_tech', name: '射线接收', tier: 12, costs: [{ itemId: 'information_matrix', amount: 26 }, { itemId: 'gravity_matrix', amount: 24 }], prerequisites: ['dyson_swarm'], summary: '把戴森云汇聚的恒星光重新收回来用。', unlocks: ['射线接收站', '临界光子'] },
    antimatter_tech: { id: 'antimatter_tech', name: '质能转换', tier: 13, costs: [{ itemId: 'information_matrix', amount: 27 }, { itemId: 'gravity_matrix', amount: 26 }], prerequisites: ['ray_receiver_tech', 'particle_physics'], summary: '拆分临界光子，驾驭正反物质的湮灭之火。', unlocks: ['质能转换', '湮灭约束球', '反物质燃料棒'] },
    artificial_star_tech: { id: 'artificial_star_tech', name: '人造恒星', tier: 14, costs: [{ itemId: 'information_matrix', amount: 29 }, { itemId: 'gravity_matrix', amount: 27 }], prerequisites: ['antimatter_tech', 'fusion_power'], summary: '在行星表面点燃一颗永不熄灭的星。', unlocks: ['人造恒星'] },
    dyson_sphere_program: { id: 'dyson_sphere_program', name: '戴森球计划', tier: 15, costs: [{ itemId: 'electromagnetic_matrix', amount: 47 }, { itemId: 'energy_matrix', amount: 47 }, { itemId: 'structure_matrix', amount: 47 }, { itemId: 'information_matrix', amount: 47 }, { itemId: 'gravity_matrix', amount: 47 }, { itemId: 'universe_matrix', amount: 47 }], prerequisites: ['universe_matrix'], summary: '从会衰减的戴森云走向永存的戴森球。', unlocks: ['框架材料', '戴森球组件', '戴森球结构规划'] },
    vertical_launching: { id: 'vertical_launching', name: '垂直发射', tier: 16, costs: [{ itemId: 'information_matrix', amount: 29 }, { itemId: 'gravity_matrix', amount: 27 }], prerequisites: ['dyson_sphere_program', 'deuterium_fuel'], summary: '建起发射井，让火箭批量升空。', unlocks: ['小型运载火箭', '垂直发射井', '运载火箭发射'] },
    universe_matrix: { id: 'universe_matrix', name: '宇宙矩阵', tier: 14, costs: [{ itemId: 'electromagnetic_matrix', amount: 47 }, { itemId: 'energy_matrix', amount: 47 }, { itemId: 'structure_matrix', amount: 47 }, { itemId: 'information_matrix', amount: 47 }, { itemId: 'gravity_matrix', amount: 47 }], prerequisites: ['antimatter_tech'], summary: '五色矩阵与反物质融合成白色的终极真理。', unlocks: ['宇宙矩阵生产', '六色矩阵科研'] },
    heavy_colliders: { id: 'heavy_colliders', name: '重型对撞', tier: 12, costs: [{ itemId: 'information_matrix', amount: 26 }, { itemId: 'gravity_matrix', amount: 26 }], prerequisites: ['exotic_matter', 'particle_physics'], summary: '环形超导加速器把对撞产能翻倍。', unlocks: ['重型对撞机'] },

    // —— tier 5（10）——
    quantum_assembling: { id: 'quantum_assembling', name: '量子装配', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 26 }, { itemId: 'universe_matrix', amount: 15 }], prerequisites: ['universe_matrix', 'high_speed_assembling'], summary: '量子打印头把装配速度推到 1.5 倍。', unlocks: ['制造台 Mk.III'] },
    super_conveyor: { id: 'super_conveyor', name: '超磁物流', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 26 }, { itemId: 'universe_matrix', amount: 15 }], prerequisites: ['universe_matrix', 'motor_drive'], summary: '磁悬浮带面让单线吞吐达到每秒三十件。', unlocks: ['超磁传送带'] },
    catalytic_refining: { id: 'catalytic_refining', name: '催化精炼', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 24 }, { itemId: 'universe_matrix', amount: 15 }], prerequisites: ['universe_matrix', 'xray_cracking'], summary: '催化剂让原油里没有一滴被浪费。', unlocks: ['催化精炼厂', '催化裂化配方'] },
    photon_power: { id: 'photon_power', name: '光子发电', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 26 }, { itemId: 'universe_matrix', amount: 20 }], prerequisites: ['universe_matrix', 'ray_receiver_tech'], summary: '用巨型反射镜把恒星光变成纯电力。', unlocks: ['光子发电站'] },
    quantum_storage: { id: 'quantum_storage', name: '量子仓储', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 24 }, { itemId: 'universe_matrix', amount: 15 }], prerequisites: ['universe_matrix', 'planetary_logistics'], summary: '空间折叠让仓库的内部比外面大得多。', unlocks: ['量子储物仓'] },
    galaxy_navigation_1: { id: 'galaxy_navigation_1', name: '星系航线·近域', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 26 }, { itemId: 'universe_matrix', amount: 20 }], prerequisites: ['universe_matrix', 'space_warp'], summary: '校准第一批远航航标，邻近星系不再遥不可及。', unlocks: ['近域星系勘探', '跨星系航行许可 I'] },
    galaxy_navigation_2: { id: 'galaxy_navigation_2', name: '星系航线·深空', tier: 16, costs: [{ itemId: 'gravity_matrix', amount: 29 }, { itemId: 'universe_matrix', amount: 26 }], prerequisites: ['galaxy_navigation_1', 'rare_resources'], summary: '深空航道穿过多片星云，抵达更遥远的恒星。', unlocks: ['深空星系勘探', '跨星系航行许可 II'] },
    galaxy_navigation_3: { id: 'galaxy_navigation_3', name: '星系航线·远岸', tier: 17, costs: [{ itemId: 'gravity_matrix', amount: 32 }, { itemId: 'universe_matrix', amount: 29 }], prerequisites: ['galaxy_navigation_2'], summary: '航图尽头是最亮的蓝巨星，也是最大的宝藏。', unlocks: ['远岸星系勘探', '跨星系航行许可 III'] },
    orbital_freight: { id: 'orbital_freight', name: '轨道货运', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 26 }, { itemId: 'universe_matrix', amount: 24 }], prerequisites: ['universe_matrix', 'interstellar_logistics'], summary: '把物流枢纽搬上轨道，吞吐量指数级攀升。', unlocks: ['轨道货运码头'] },
    research_network: { id: 'research_network', name: '科研网络', tier: 15, costs: [{ itemId: 'gravity_matrix', amount: 26 }, { itemId: 'universe_matrix', amount: 20 }], prerequisites: ['universe_matrix', 'quantum_lab_tech'], summary: '所有研究站并网演算，进度共享。', unlocks: ['研究速度 +25%'] },

    // —— tier 6（9）——
    stellar_engineering: { id: 'stellar_engineering', name: '恒星工程', tier: 17, costs: [{ itemId: 'universe_matrix', amount: 35 }], prerequisites: ['universe_matrix', 'vertical_launching'], summary: '优化帆面涂层，太阳帆在恒星风里活得更久。', unlocks: ['太阳帆衰减 -50%'] },
    rocket_payload: { id: 'rocket_payload', name: '火箭载荷优化', tier: 17, costs: [{ itemId: 'universe_matrix', amount: 35 }], prerequisites: ['universe_matrix', 'vertical_launching'], summary: '每一枚火箭都带更多的结构件上天。', unlocks: ['戴森球点数 +25%'] },
    antimatter_refinement: { id: 'antimatter_refinement', name: '反物质精炼', tier: 15, costs: [{ itemId: 'universe_matrix', amount: 35 }], prerequisites: ['universe_matrix', 'antimatter_tech'], summary: '提高对撞机的捕获率，反物质产量上扬。', unlocks: ['反物质产出 +25%'] },
    galactic_logistics: { id: 'galactic_logistics', name: '星系物流', tier: 17, costs: [{ itemId: 'universe_matrix', amount: 41 }], prerequisites: ['galaxy_navigation_2', 'orbital_freight'], summary: '更大的船舱与更聪明的调度。', unlocks: ['运输船载重 +50%'] },
    deep_space_mining: { id: 'deep_space_mining', name: '深空采矿', tier: 17, costs: [{ itemId: 'universe_matrix', amount: 41 }], prerequisites: ['galaxy_navigation_2', 'advanced_mining'], summary: '为稀有矿脉定制开采协议。', unlocks: ['稀有矿产 +50%'] },
    universal_science: { id: 'universal_science', name: '宇宙科学', tier: 16, costs: [{ itemId: 'universe_matrix', amount: 47 }], prerequisites: ['research_network', 'universe_matrix'], summary: '六色矩阵统一科研管线，进度全面加速。', unlocks: ['研究速度 +50%'] },
    dyson_mastery: { id: 'dyson_mastery', name: '戴森球大师', tier: 18, costs: [{ itemId: 'universe_matrix', amount: 53 }], prerequisites: ['stellar_engineering', 'rocket_payload'], summary: '发射流程的每一次优化都省下真金白银。', unlocks: ['戴森发射成本 -20%'] },
    sphere_architect: { id: 'sphere_architect', name: '球体建筑学', tier: 19, costs: [{ itemId: 'universe_matrix', amount: 62 }], prerequisites: ['dyson_mastery'], summary: '更优雅的结构设计，同样的材料撑起更多的壳。', unlocks: ['戴森球结构点数 +25%'] },
    cosmic_harmony: { id: 'cosmic_harmony', name: '宇宙大同', tier: 20, costs: [{ itemId: 'universe_matrix', amount: 107 }], prerequisites: ['sphere_architect', 'universal_science', 'galactic_logistics', 'deep_space_mining'], summary: '科技树的终点：工业与宇宙终于达成和解。', unlocks: ['全局生产 +10%', '终局成就'] },
  };

  /* ------------------------------------------------------------
   * 科技阶段（stage）：科技树分列依据。
   * stage = 该科技成本中「最高阶矩阵」的序号，并沿前置依赖传播
   * （stage ≥ 全部前置的 stage），保证只需初级矩阵的科技全在前面，
   * 与参考项目的线性解锁进度对齐。
   * tier 语义不变（= 依赖深度，有回归测试）。
   * ---------------------------------------------------------- */
  const TECH_STAGES = [
    { id: 'electromagnetic_matrix', name: '电磁', color: '#e25555' },
    { id: 'energy_matrix', name: '能量', color: '#4d8fe0' },
    { id: 'structure_matrix', name: '结构', color: '#e0b84d' },
    { id: 'information_matrix', name: '信息', color: '#9b59d0' },
    { id: 'gravity_matrix', name: '引力', color: '#4dc26b' },
    { id: 'universe_matrix', name: '宇宙', color: '#e8ecef' },
  ];
  (function assignTechStages() {
    const stageOfItem = {};
    TECH_STAGES.forEach(function (s, i) { stageOfItem[s.id] = i; });
    const ordered = Object.keys(TECHNOLOGIES).map(function (id) { return TECHNOLOGIES[id]; })
      .sort(function (a, b) { return (a.tier || 0) - (b.tier || 0); }); // tier=依赖深度，前置必先处理
    for (var i = 0; i < ordered.length; i++) {
      var tech = ordered[i];
      var stage = 0;
      var costs = tech.costs || [];
      for (var j = 0; j < costs.length; j++) {
        var s = stageOfItem[costs[j].itemId];
        if (s !== undefined && s > stage) stage = s;
      }
      var pres = tech.prerequisites || [];
      for (var j2 = 0; j2 < pres.length; j2++) {
        var pre = TECHNOLOGIES[pres[j2]];
        if (pre && (pre.stage || 0) > stage) stage = pre.stage;
      }
      tech.stage = stage;
    }
  })();

  /* ------------------------------------------------------------
   * 星系（8）与行星（22）—— 命名与设定全部原创
   * ---------------------------------------------------------- */
  const STAR_SYSTEMS = {
    dawnlight: { id: 'dawnlight', name: '晨曦系', color: '#e1c05a', distanceLy: 0, description: '文明的摇篮，一颗温润的黄色主序星照耀着母星与她的姊妹行星。' },
    frostriver: { id: 'frostriver', name: '霜川系', color: '#87bdd1', distanceLy: 4.2, description: '橙色矮星低垂，冰封的行星保存着大量天然晶格矿物。' },
    yaoyang: { id: 'yaoyang', name: '曜阳系', color: '#e8dc9b', distanceLy: 9.4, description: '明亮的 F 型恒星之下，草原与深海行星适合建立阳光基地。' },
    danlu: { id: 'danlu', name: '丹炉系', color: '#c76c56', distanceLy: 15.7, description: '暗红的矮星像一座炉膛，周边行星遍布荒漠与火山灰。' },
    yunshu: { id: 'yunshu', name: '云枢系', color: '#8ba8d3', distanceLy: 20.4, description: '气巨星与晶漠交织的枢纽星域，戴森工程回报可观。' },
    subi: { id: 'subi', name: '素璧系', color: '#aec7e0', distanceLy: 18.7, description: '白矮星冷光如璧，盐湖与黑曜行星是天然的中转驿站。' },
    xuanshu: { id: 'xuanshu', name: '玄枢系', color: '#a783d0', distanceLy: 11.8, description: '中子星的极端磁场重塑了岩层，唯一产单极磁石的星域。' },
    canglan: { id: 'canglan', name: '沧蓝系', color: '#6fa8ff', distanceLy: 30.0, description: '终局航线的尽头，炽烈的蓝巨星以最慷慨的光回报殖民者。' },
  };

  const PLANETS = {
    // —— 晨曦系（3）——
    qiming: { id: 'qiming', name: '启明 I', code: '母星', color: '#59c0a9', environment: '温带海洋行星', systemId: 'dawnlight', orbitIndex: 1, solarMultiplier: 1.0, isHome: true, oreTypes: ['iron_ore', 'copper_ore', 'stone', 'coal', 'crude_oil', 'water'], description: '文明启航的地方，浅海与丘陵下埋着最熟悉的铁与煤。' },
    yanli: { id: 'yanli', name: '焰砾 II', code: '熔岩星', color: '#d8794d', environment: '熔岩行星', systemId: 'dawnlight', orbitIndex: 2, solarMultiplier: 1.4, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'silicon_ore', 'titanium_ore', 'coal', 'sulfuric_acid', 'kimberlite_ore'], description: '地表是奔流的熔岩，裂缝里却渗出硫酸与贵金属矿脉。' },
    lanhuan: { id: 'lanhuan', name: '岚环 III', code: '气巨星', color: '#6badc7', environment: '冰气态巨星', systemId: 'dawnlight', orbitIndex: 3, solarMultiplier: 1.0, isHome: false, oreTypes: ['fire_ice', 'hydrogen'], description: '巨大的淡蓝色行星拖着冰环，云层深处可采可燃冰。' },

    // —— 霜川系（3）——
    haoji: { id: 'haoji', name: '皓矶 I', code: '冰原星', color: '#84bfd1', environment: '永冻冰原行星', systemId: 'frostriver', orbitIndex: 1, solarMultiplier: 1.0, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'titanium_ore', 'silicon_ore', 'fire_ice', 'optical_grating_crystal', 'spiniform_stalagmite_crystal'], description: '万年寒冰之下，光栅石与刺笋结晶像灯火一样闪。' },
    linfeng: { id: 'linfeng', name: '凛风 II', code: '冰巨星', color: '#5999c0', environment: '可燃冰冰巨星', systemId: 'frostriver', orbitIndex: 2, solarMultiplier: 1.0, isHome: false, oreTypes: ['fire_ice', 'hydrogen'], description: '呼啸的急流把可燃冰碎块抛洒在云海之间。' },
    xuexiu: { id: 'xuexiu', name: '雪岫 III', code: '冻土星', color: '#8fcbd4', environment: '冻土苔原行星', systemId: 'frostriver', orbitIndex: 3, solarMultiplier: 1.1, isHome: false, oreTypes: ['iron_ore', 'stone', 'coal', 'titanium_ore', 'fractal_silicon'], description: '雪谷之间露出黑色岩层，分形硅在冻土中生长。' },

    // —— 曜阳系（3）——
    woye: { id: 'woye', name: '沃野 I', code: '草原星', color: '#8dc059', environment: '风暴草原行星', systemId: 'yaoyang', orbitIndex: 1, solarMultiplier: 1.4, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'stone', 'coal', 'silicon_ore', 'water', 'crude_oil'], description: '金色草原一望无际，地下矿藏同样慷慨。' },
    bitin: { id: 'bitin', name: '碧汀 II', code: '海洋星', color: '#59abc0', environment: '深海群岛行星', systemId: 'yaoyang', orbitIndex: 2, solarMultiplier: 1.2, isHome: false, oreTypes: ['stone', 'water', 'crude_oil', 'copper_ore', 'silicon_ore'], description: '群岛如棋子撒在碧海上，油架立于浅滩之间。' },
    yaoguan: { id: 'yaoguan', name: '曜冠 III', code: '氢巨星', color: '#cbb975', environment: '高氢气态巨星', systemId: 'yaoyang', orbitIndex: 3, solarMultiplier: 1.0, isHome: false, oreTypes: ['hydrogen', 'fire_ice'], description: '戴着一圈光环的氢巨星，是天然的燃料仓库。' },

    // —— 丹炉系（3）——
    zhefeng: { id: 'zhefeng', name: '赭风 I', code: '荒漠星', color: '#c7965d', environment: '干旱荒漠行星', systemId: 'danlu', orbitIndex: 1, solarMultiplier: 1.5, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'stone', 'coal', 'silicon_ore', 'fractal_silicon', 'optical_grating_crystal'], description: '赭色沙暴常年不歇，却把稀有晶体吹得满地都是。' },
    rongrang: { id: 'rongrang', name: '熔壤 II', code: '火山星', color: '#c07059', environment: '火山灰行星', systemId: 'danlu', orbitIndex: 2, solarMultiplier: 1.2, isHome: false, oreTypes: ['iron_ore', 'coal', 'silicon_ore', 'titanium_ore', 'sulfuric_acid', 'kimberlite_ore'], description: '火山灰肥沃得反常，酸雨把金属矿脉洗得锃亮。' },
    danxiao: { id: 'danxiao', name: '丹霄 III', code: '炎巨星', color: '#c1755b', environment: '高温气态巨星', systemId: 'danlu', orbitIndex: 3, solarMultiplier: 1.2, isHome: false, oreTypes: ['hydrogen', 'fire_ice'], description: '被母星烤得通红，云顶却冷静地飘着冰晶。' },

    // —— 云枢系（3）——
    guiyu: { id: 'guiyu', name: '硅屿 I', code: '晶漠星', color: '#8cd0d4', environment: '硅晶荒漠行星', systemId: 'yunshu', orbitIndex: 1, solarMultiplier: 1.6, isHome: false, oreTypes: ['silicon_ore', 'fractal_silicon', 'stone', 'copper_ore', 'optical_grating_crystal'], description: '整片大陆是会反光的硅晶沙漠，日光在晶棱上碎成彩虹。' },
    fengzhou: { id: 'fengzhou', name: '风洲 II', code: '风暴星', color: '#59c0ac', environment: '高风速海陆行星', systemId: 'yunshu', orbitIndex: 2, solarMultiplier: 1.5, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'stone', 'coal', 'water'], description: '终年飓风的星球，是风力发电机组的天堂。' },
    yunmao: { id: 'yunmao', name: '云锚 III', code: '冰巨星', color: '#75a9cb', environment: '明亮冰巨星', systemId: 'yunshu', orbitIndex: 3, solarMultiplier: 1.0, isHome: false, oreTypes: ['fire_ice', 'hydrogen'], description: '像一枚钉在星域中央的银锚，云海富藏可燃冰。' },

    // —— 素璧系（2）——
    yanjing: { id: 'yanjing', name: '盐镜 I', code: '盐湖星', color: '#d3c98c', environment: '盐湖干海盆行星', systemId: 'subi', orbitIndex: 1, solarMultiplier: 1.3, isHome: false, oreTypes: ['stone', 'water', 'copper_ore', 'silicon_ore'], description: '干涸的海盆结成一面巨大的盐镜，倒映着白矮星的光。' },
    xuanrang: { id: 'xuanrang', name: '玄壤 II', code: '黑曜星', color: '#5984c0', environment: '黑曜火山行星', systemId: 'subi', orbitIndex: 2, solarMultiplier: 1.0, isHome: false, oreTypes: ['iron_ore', 'coal', 'titanium_ore', 'sulfuric_acid', 'kimberlite_ore'], description: '黑曜岩原野裂谷纵横，深处埋着金伯利矿管。' },

    // —— 玄枢系（2）——
    hengmu: { id: 'hengmu', name: '恒暮 I', code: '永夜星', color: '#5983c0', environment: '潮汐锁定行星', systemId: 'xuanshu', orbitIndex: 1, solarMultiplier: 1.0, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'titanium_ore', 'silicon_ore', 'unipolar_magnet'], description: '一面永昼一面永夜，晨昏线上响着磁暴的轰鸣。' },
    ciyan: { id: 'ciyan', name: '磁岩 II', code: '磁暴星', color: '#678dc5', environment: '强磁场岩行星', systemId: 'xuanshu', orbitIndex: 2, solarMultiplier: 1.0, isHome: false, oreTypes: ['unipolar_magnet', 'iron_ore', 'titanium_ore', 'copper_ore'], description: '中子星的磁场把整颗行星磁化，山岩自己会指向极点。' },

    // —— 沧蓝系（3）——
    nutao: { id: 'nutao', name: '怒涛 I', code: '飓风星', color: '#59adc0', environment: '高风速海洋行星', systemId: 'canglan', orbitIndex: 1, solarMultiplier: 1.8, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'stone', 'coal', 'water', 'spiniform_stalagmite_crystal'], description: '蓝巨星的光把海水晒成沸腾的怒涛，浪里藏着晶柱。' },
    zhuoxin: { id: 'zhuoxin', name: '灼心 II', code: '炽熔星', color: '#d65f43', environment: '超高热熔岩行星', systemId: 'canglan', orbitIndex: 2, solarMultiplier: 2.0, isHome: false, oreTypes: ['iron_ore', 'titanium_ore', 'silicon_ore', 'sulfuric_acid', 'kimberlite_ore', 'fractal_silicon'], description: '离蓝巨星太近，整颗行星像一块烧红的炭。' },
    yelan: { id: 'yelan', name: '夜澜 III', code: '永夜星', color: '#597cc0', environment: '潮汐锁定永夜行星', systemId: 'canglan', orbitIndex: 3, solarMultiplier: 1.1, isHome: false, oreTypes: ['iron_ore', 'copper_ore', 'titanium_ore', 'optical_grating_crystal', 'spiniform_stalagmite_crystal'], description: '永远背对巨星的暗面，矿脉在极光下泛着幽光。' },
  };

  /* 六种科研矩阵（tier 0→5：红/蓝/黄/紫/绿/白） */
  const MATRIX_ITEM_IDS = [
    'electromagnetic_matrix',
    'energy_matrix',
    'structure_matrix',
    'information_matrix',
    'gravity_matrix',
    'universe_matrix',
  ];

  /* 建造面板顺序（按解锁科技层级排列，38 个） */
  const BUILDING_ORDER = [
    'mining_machine', 'arc_smelter', 'assembler_mk1', 'matrix_lab', 'wind_turbine', 'splitter', 'storage_mk1',
    'water_pump', 'oil_extractor', 'oil_refinery', 'storage_tank', 'thermal_power_plant', 'solar_panel',
    'chemical_plant', 'fractionator', 'energy_hub', 'geothermal_plant', 'spray_coater',
    'planetary_station', 'particle_collider', 'quantum_lab', 'advanced_miner', 'assembler_mk2', 'interstellar_station', 'orbital_collector',
    'plane_smelter', 'fusion_plant', 'em_rail_ejector', 'ray_receiver', 'quantum_chemical_plant', 'heavy_collider', 'artificial_star', 'launching_silo',
    'catalytic_refiner', 'assembler_mk3', 'storage_mk2', 'orbital_mirror', 'orbital_freight_terminal',
  ];

  /* 增产剂喷涂档位（参照 DSPONLINE PROLIFERATORS）：
     每档定义 sprayPoints（点数，供后续扩展）、额外产出加成、加速加成与加速模式耗电倍率 */
  const SPRAY_TIERS = {
    1: { itemId: 'proliferator_mk1', sprayPoints: 12, extraProductBonus: 0.125, speedBonus: 0.25, powerMultiplier: 1.3 },
    2: { itemId: 'proliferator_mk2', sprayPoints: 24, extraProductBonus: 0.2, speedBonus: 0.5, powerMultiplier: 1.7 },
    3: { itemId: 'proliferator_mk3', sprayPoints: 60, extraProductBonus: 0.25, speedBonus: 1, powerMultiplier: 2.5 },
  };

  /* 升级建筑 → 基础建筑（其可用配方继承自基础建筑） */
  const RECIPE_BASE_BUILDING = {
    assembler_mk2: 'assembler_mk1',
    assembler_mk3: 'assembler_mk1',
    plane_smelter: 'arc_smelter',
    quantum_chemical_plant: 'chemical_plant',
    catalytic_refiner: 'oil_refinery',
    heavy_collider: 'particle_collider',
    quantum_lab: 'matrix_lab',
  };

  /* ------------------------------------------------------------
   * 便捷查询函数（纯函数，无副作用）
   * ---------------------------------------------------------- */
  function item(id) { return Object.prototype.hasOwnProperty.call(ITEMS, id) ? ITEMS[id] : null; }
  function recipe(id) { return Object.prototype.hasOwnProperty.call(RECIPES, id) ? RECIPES[id] : null; }
  function building(id) { return Object.prototype.hasOwnProperty.call(BUILDINGS, id) ? BUILDINGS[id] : null; }
  function tech(id) { return Object.prototype.hasOwnProperty.call(TECHNOLOGIES, id) ? TECHNOLOGIES[id] : null; }
  function planet(id) { return Object.prototype.hasOwnProperty.call(PLANETS, id) ? PLANETS[id] : null; }

  /** 某建筑可执行的配方列表（升级建筑继承基础建筑的配方） */
  function recipesForBuilding(buildingId) {
    const baseId = RECIPE_BASE_BUILDING[buildingId] || buildingId;
    const result = [];
    for (const key in RECIPES) {
      if (RECIPES[key].buildingId === baseId) result.push(RECIPES[key]);
    }
    return result;
  }

  /** 按类别分组返回物品对象（保持定义顺序） */
  function itemsByCategory() {
    const groups = {};
    for (const key in ITEMS) {
      const it = ITEMS[key];
      if (!groups[it.category]) groups[it.category] = [];
      groups[it.category].push(it);
    }
    return groups;
  }

  /* ------------------------------------------------------------
   * 挂载全局命名空间
   * ---------------------------------------------------------- */
  globalThis.DSP_CONTENT = {
    ITEMS: ITEMS,
    RECIPES: RECIPES,
    BUILDINGS: BUILDINGS,
    BELTS: BELTS,
    TECHNOLOGIES: TECHNOLOGIES,
    TECH_STAGES: TECH_STAGES,
    STAR_SYSTEMS: STAR_SYSTEMS,
    PLANETS: PLANETS,
    MATRIX_ITEM_IDS: MATRIX_ITEM_IDS,
    BUILDING_ORDER: BUILDING_ORDER,
    RECIPE_BASE_BUILDING: RECIPE_BASE_BUILDING,
    SPRAY_TIERS: SPRAY_TIERS,

    item: item,
    recipe: recipe,
    building: building,
    tech: tech,
    planet: planet,
    recipesForBuilding: recipesForBuilding,
    itemsByCategory: itemsByCategory,
  };

  /* Node 冒烟测试环境提示（浏览器中静默） */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = globalThis.DSP_CONTENT;
  }
})();
