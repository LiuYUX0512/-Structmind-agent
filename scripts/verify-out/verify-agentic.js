//#region scripts/mocks/lark-toolkit-mock.ts
var scopedStorage = {
	_data: {},
	getItem(k) {
		return this._data[k] ?? null;
	},
	setItem(k, v) {
		this._data[k] = v;
	},
	removeItem(k) {
		delete this._data[k];
	}
};
//#endregion
//#region src/data/structure.ts
var MOCK_WEIGHT_CONFIG = {
	cost: 25,
	duration: 25,
	safety: 25,
	green: 25
};
/** 估算建筑高度（按层高 3m 计） */
function calculateBuildingHeight(floors) {
	return Math.round(floors * 3 * 10) / 10;
}
/**
* 按 GB/T 50011 查表得到各结构体系的弹性层间位移角限值
* 规范来源：《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）表 5.5.1
* 强制性通用规范：GB 55002-2021《建筑与市政工程抗震通用规范》第 5.1.1 条
* 注：组合结构/砌体/木结构/空间桁架表5.5.1未单列，为工程经验参考值
*/
var DRIFT_LIMITS = {
	frame: 1 / 550,
	"frame-shearwall": 1 / 800,
	shearwall: 1 / 1e3,
	steel: 1 / 250,
	prefabricated: 1 / 800,
	"prefab-steel": 1 / 250,
	composite: 1 / 650,
	masonry: 1 / 1200,
	"frame-corewall": 1 / 800,
	"tube-in-tube": 1 / 1e3,
	"mass-timber": 1 / 350,
	"space-truss": 1 / 300,
	"frame-corewall-frame": 1 / 800
};
/**
* 各结构体系在多遇地震下层间位移角的经验估算（简化）
* 基于 8度设防、Ⅱ类场地、100m 高度的经验值，按烈度/高度/场地线性修正
*/
function estimateDriftRatio(schemeId, intensity, height, soilCategory) {
	let drift = {
		frame: 1 / 400,
		"frame-shearwall": 1 / 900,
		shearwall: 1 / 1200,
		steel: 1 / 220,
		prefabricated: 1 / 850,
		"prefab-steel": 1 / 230,
		composite: 1 / 500,
		masonry: 1 / 1500,
		"frame-corewall": 1 / 950,
		"tube-in-tube": 1 / 850,
		"mass-timber": 1 / 300,
		"space-truss": 1 / 250
	}[schemeId] || 1 / 800;
	const intensityFactor = Math.pow(1.8, intensity - 8);
	drift *= intensityFactor;
	const heightFactor = height / 100;
	drift *= Math.max(.5, Math.min(2, heightFactor));
	if (soilCategory === "Ⅲ") drift *= 1.1;
	if (soilCategory === "Ⅳ") drift *= 1.2;
	return drift;
}
/**
* 剪重比（楼层最小地震剪力系数）最小值
* 依据：GB 55002-2021《建筑与市政工程抗震通用规范》第 4.2.3 条（强制性）
*        及 GB/T 50011-2010（2024年局部修订）表 5.2.5
* 说明：本工具按 7度0.10g、8度0.20g 取值；
*       设计基本地震加速度为 7度0.15g、8度0.30g 的地区，
*       框架结构剪重比最小值分别取 0.036、0.072，
*       其他结构分别取 0.024、0.048。
*/
var SHEAR_WEIGHT_RATIO_MIN = {
	"6": {
		frame: .012,
		other: .008
	},
	"7": {
		frame: .024,
		other: .016
	},
	"8": {
		frame: .048,
		other: .032
	},
	"9": {
		frame: .096,
		other: .064
	}
};
/**
* 估算剪重比（经验法）
* 简化计算：剪重比 ≈ 烈度系数 × 结构类型系数 × 场地修正
*/
function estimateShearWeightRatio(schemeId, intensity, soilCategory) {
	const key = schemeId === "frame" ? "frame" : "other";
	let ratio = (SHEAR_WEIGHT_RATIO_MIN[intensity]?.[key] || .016) * 1.3;
	if (soilCategory === "Ⅰ") ratio *= .9;
	if (soilCategory === "Ⅲ") ratio *= 1.05;
	if (soilCategory === "Ⅳ") ratio *= 1.15;
	return Math.round(ratio * 1e4) / 1e4;
}
/**
* 估算结构基本周期（经验公式）
* 框架结构：T1 ≈ 0.1n（n为层数）
* 框剪/框筒：T1 ≈ 0.08n
* 剪力墙/筒中筒：T1 ≈ 0.06n
* 钢结构：T1 ≈ 0.12n
*/
function estimatePeriod(schemeId, floors) {
	const coeff = {
		frame: .1,
		"frame-shearwall": .08,
		shearwall: .06,
		steel: .12,
		prefabricated: .09,
		"prefab-steel": .11,
		composite: .085,
		masonry: .07,
		"frame-corewall": .06,
		"tube-in-tube": .055,
		"mass-timber": .095,
		"space-truss": .15
	}[schemeId] || .08;
	return Math.round(coeff * floors * 100) / 100;
}
/**
* 估算扭转周期比 Tt/T1
* 经验值：规则建筑 0.6~0.85，不规则可能更高
* 限制：A级高度 ≤ 0.9，B级高度 ≤ 0.85
*/
function estimatePeriodRatio(schemeId) {
	return {
		frame: .8,
		"frame-shearwall": .75,
		shearwall: .7,
		steel: .82,
		prefabricated: .78,
		"prefab-steel": .8,
		composite: .78,
		masonry: .72,
		"frame-corewall": .68,
		"tube-in-tube": .62,
		"mass-timber": .75,
		"space-truss": .85
	}[schemeId] || .75;
}
/**
* 规范符合性计算 - 基于真实简化公式
* 返回包含计算链的 INormCompliance
*/
function calculateNormCompliance(schemeId, params) {
	const parsedIntensity = parseInt(params.seismicIntensity, 10);
	const intensity = isNaN(parsedIntensity) ? 7 : Math.max(6, Math.min(9, parsedIntensity));
	const height = calculateBuildingHeight(params.floors);
	const schemeStandardsMap = {
		frame: [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55008-2021《混凝土结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）",
			"《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）",
			"《建筑结构荷载规范》GB 50009-2012"
		],
		"frame-shearwall": [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55008-2021《混凝土结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）",
			"《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）",
			"《高层建筑混凝土结构技术规程》JGJ 3-2010",
			"《建筑结构荷载规范》GB 50009-2012"
		],
		shearwall: [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55008-2021《混凝土结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）",
			"《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）",
			"《高层建筑混凝土结构技术规程》JGJ 3-2010"
		],
		steel: [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）",
			"《钢结构设计标准》GB/T 50017-2017",
			"《高层民用建筑钢结构技术规程》JGJ 99-2015",
			"《建筑设计防火规范》GB 50016-2014（2018版）"
		],
		prefabricated: [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55008-2021《混凝土结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）",
			"《装配式混凝土建筑技术标准》GB/T 51231-2016",
			"《装配式建筑评价标准》GB/T 51129-2017",
			"《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）"
		],
		"prefab-steel": [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55006-2021《钢结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《钢结构设计标准》GB/T 50017-2017",
			"《装配式钢结构建筑技术标准》GB/T 51232-2016",
			"《装配式建筑评价标准》GB/T 51129-2017"
		],
		composite: [
			"GB 55004-2021《组合结构通用规范》（强制性）",
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55008-2021《混凝土结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）",
			"《钢结构设计标准》GB/T 50017-2017"
		],
		masonry: [
			"GB 55007-2021《砌体结构通用规范》（强制性）",
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《砌体结构设计规范》GB 50003-2011",
			"《建筑抗震设计标准》GB/T 50011-2010（2024年局部修订）"
		],
		"frame-corewall": [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55008-2021《混凝土结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）",
			"《高层建筑混凝土结构技术规程》JGJ 3-2010"
		],
		"tube-in-tube": [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55008-2021《混凝土结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《混凝土结构设计标准》GB/T 50010-2010（2024年局部修订）",
			"《高层建筑混凝土结构技术规程》JGJ 3-2010"
		],
		"mass-timber": [
			"GB 55005-2021《木结构通用规范》（强制性）",
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《木结构设计标准》GB 50005-2017"
		],
		"space-truss": [
			"GB 55002-2021《建筑与市政工程抗震通用规范》（强制性）",
			"GB 55006-2021《钢结构通用规范》（强制性）",
			"GB 55037-2022《建筑防火通用规范》（强制性）",
			"《钢结构设计标准》GB/T 50017-2017",
			"《空间网格结构技术规程》JGJ 7-2010"
		]
	};
	const schemeNameMap = {
		frame: "框架结构",
		"frame-shearwall": "框架-剪力墙结构",
		shearwall: "剪力墙结构",
		steel: "钢结构",
		prefabricated: "装配式结构"
	};
	const driftLimit = DRIFT_LIMITS[schemeId] || 1 / 800;
	const driftEstimate = estimateDriftRatio(schemeId, intensity, height, params.soilCategory);
	const driftRatioPass = driftEstimate <= driftLimit;
	const driftRatioNearLimit = driftEstimate / driftLimit > .9;
	const swrMin = SHEAR_WEIGHT_RATIO_MIN[params.seismicIntensity]?.[schemeId === "frame" ? "frame" : "other"] || .016;
	const swrEstimate = estimateShearWeightRatio(schemeId, params.seismicIntensity, params.soilCategory);
	const T1 = estimatePeriod(schemeId, params.floors);
	const TtT1 = estimatePeriodRatio(schemeId);
	const periodLimit = height > 150 ? .85 : .9;
	const schemeName = schemeNameMap[schemeId] || schemeId;
	const standards = schemeStandardsMap[schemeId] || schemeStandardsMap["frame-shearwall"];
	const clauseTemplates = {
		drift: {
			clauseText: "多遇地震作用下，结构弹性层间位移角应满足限值要求：框架结构 1/550；框架-抗震墙、板柱-抗震墙、框架-核心筒 1/800；抗震墙、筒中筒 1/1000；多高层钢结构 1/250。该限值用于控制结构在多遇地震下的侧向变形，保证非结构构件不发生严重破坏，过大说明结构侧向刚度不足。",
			source: "GB/T 50011-2010（2024年局部修订）表 5.5.1 弹性层间位移角限值"
		},
		swr: {
			clauseText: "结构各楼层对应于地震作用标准值的楼层剪力系数 λ 不应小于 λ_min。框架结构：6度(0.05g) 0.008、7度(0.10g) 0.012、8度(0.20g) 0.024、9度(0.40g) 0.048；其他结构体系为框架结构的 2/3：0.004 / 0.008 / 0.016 / 0.032。剪重比不足说明地震作用偏小，需按规定进行调整。",
			source: "GB 55002-2021 第 4.2.3 条；GB/T 50011-2010（2024年局部修订）表 5.2.5"
		},
		period: {
			clauseText: "结构扭转为主的第一自振周期 Tt 与平动为主的第一自振周期 T1 之比，A级高度高层建筑不应大于 0.90，B级高度高层建筑（>150m）不应大于 0.85。周期比用于控制结构扭转效应，防止扭转为主的破坏模式。",
			source: "JGJ 3-2010《高层建筑混凝土结构技术规程》第 3.4.5 条"
		},
		height: {
			clauseText: "现浇钢筋混凝土房屋的最大适用高度应符合规范要求（单位 m）：框架结构 6/7度 60m、8度 40m、9度 24m；框架-抗震墙 130/120/100/50m；全落地抗震墙 140/120/100/60m；框架-核心筒 150/130/100/70m；筒中筒 180/150/120/80m。超限工程需进行专项论证。",
			source: "GB/T 50011-2010（2024年局部修订）表 6.1.1"
		},
		axialRatio: {
			clauseText: "抗震墙底部加强部位墙肢轴压比限值：一级（9度）≤ 0.40；一级（7、8度）≤ 0.50；二、三级 ≤ 0.60。轴压比是控制墙肢延性、防止脆性破坏的重要指标。",
			source: "GB/T 50010-2010（2024年局部修订）第 11.7.16 条"
		},
		fireSteel: {
			clauseText: "一级耐火等级高层建筑，钢柱耐火极限不应低于 3.00h，钢梁不应低于 2.00h，楼板不应低于 1.50h。钢结构必须采取防火保护措施（防火涂料、防火板等）。",
			source: "GB 55037-2022《建筑防火通用规范》表 5.2.1"
		}
	};
	function buildDriftReason(status, nearLimit, systemName, driftVal, limitVal) {
		if (status === "pass" && !nearLimit) return `本工程约 ${height}m 高${systemName}，在${intensity}度多遇地震作用下位移角约 1/${Math.round(1 / driftVal)}，小于限值 1/${Math.round(1 / limitVal)}，侧向刚度有充足余量。`;
		if (status === "pass" && nearLimit) return `位移角 1/${Math.round(1 / driftVal)} 接近限值 1/${Math.round(1 / limitVal)}，侧向刚度偏紧，设计中应注意合理布置剪力墙和核心筒，避免刚度不足。`;
		return `位移角 1/${Math.round(1 / driftVal)} 超出限值 1/${Math.round(1 / limitVal)}，说明该${systemName}体系在${intensity}度地震作用下侧向刚度不足，需增设抗震墙或加大构件截面。`;
	}
	function buildSwrReason(status, val, min) {
		if (status === "pass") return `估算剪重比约 ${(val * 100).toFixed(2)}%，高于规范最小值 ${(min * 100).toFixed(1)}%，地震作用满足最小剪力要求，基底剪力安全储备充足。`;
		return `估算剪重比约 ${(val * 100).toFixed(2)}%，接近或略低于规范限值 ${(min * 100).toFixed(1)}%，设计阶段应注意按规范第 5.2.5 条调整地震作用放大系数。`;
	}
	function buildPeriodReason(status, val, limit) {
		if (status === "pass") return `估算周期比 Tt/T1 ≈ ${val.toFixed(2)}，满足规范限值 ${limit}，说明结构平面布置较规则，扭转效应可控，抗扭性能良好。`;
		return `周期比 Tt/T1 ≈ ${val.toFixed(2)} 接近限值 ${limit}，需在设计中注意调整结构布置，使抗侧力构件尽量均匀分布，减小扭转效应。`;
	}
	function buildHeightReason(status, h, limit, systemName) {
		if (status === "pass") return `建筑高度 ${h}m ≤ 规范适用最大高度 ${limit}m（${systemName}，${intensity}度），属于常规适用范围，无需超限专项论证。`;
		return `建筑高度 ${h}m 接近或超出规范适用最大高度 ${limit}m（${systemName}，${intensity}度），属于超限高层范畴，需按规定组织超限工程抗震设防专项审查。`;
	}
	function buildAxialRatioReason(status, est, limit, grade) {
		if (status === "pass") return `底部加强部位墙肢轴压比估算 ${est}，低于限值 ${limit.toFixed(2)}（${grade}），墙肢延性满足要求，可保证大震下的变形能力。`;
		return `墙肢轴压比估算 ${est} 接近限值 ${limit.toFixed(2)}（${grade}），设计中应注意底部加强部位墙肢截面和混凝土强度等级的合理匹配。`;
	}
	const checks = [
		{
			name: "层间位移角",
			status: driftRatioPass ? driftRatioNearLimit ? "warning" : "pass" : "fail",
			value: `1/${Math.round(1 / driftEstimate)}`,
			requirement: `≤ 1/${Math.round(1 / driftLimit)}（${schemeName}）`,
			description: driftRatioPass ? "风荷载及多遇地震作用下弹性层间位移角满足规范限值要求" : "层间位移角超出规范限值，需调整结构布置或增大刚度",
			calcChain: {
				basis: "GB/T 50011-2010（2024局部修订）表 5.5.1 弹性层间位移角限值；强制性通用规范 GB 55002-2021 第 5.1.1 条",
				input: `烈度 ${intensity}度、高度 ${height}m、场地 ${params.soilCategory}类、层数 ${params.floors}层`,
				formula: "Δu/h = 基准值 × 烈度修正 × 高度修正 × 场地修正",
				result: `估算值 1/${Math.round(1 / driftEstimate)}，限值 1/${Math.round(1 / driftLimit)}`
			},
			clauseText: clauseTemplates.drift.clauseText,
			source: clauseTemplates.drift.source,
			reason: buildDriftReason(driftRatioPass ? driftRatioNearLimit ? "warning" : "pass" : "fail", driftRatioNearLimit, schemeName, driftEstimate, driftLimit)
		},
		{
			name: "剪重比",
			status: swrEstimate >= swrMin ? "pass" : "warning",
			value: `${(swrEstimate * 100).toFixed(2)}%`,
			requirement: `≥ ${(swrMin * 100).toFixed(1)}%（${params.seismicIntensity}度设防）`,
			description: swrEstimate >= swrMin ? "各楼层地震剪力系数满足规范最小值要求，安全储备充足" : "剪重比接近或略低于规范最小值，需考虑按规范调整地震作用",
			calcChain: {
				basis: "GB 55002-2021 第 4.2.3 条（强制性）及 GB/T 50011-2010 表 5.2.5 楼层最小地震剪力系数",
				input: `烈度 ${params.seismicIntensity}度、${schemeId === "frame" ? "框架" : "其他"}结构、场地 ${params.soilCategory}类`,
				formula: "λ ≥ λ_min × 场地修正（经验估算含1.3倍安全储备）",
				result: `估算 ${(swrEstimate * 100).toFixed(2)}%，限值 ${(swrMin * 100).toFixed(1)}%`
			},
			clauseText: clauseTemplates.swr.clauseText,
			source: clauseTemplates.swr.source,
			reason: buildSwrReason(swrEstimate >= swrMin ? "pass" : "warning", swrEstimate, swrMin)
		},
		{
			name: "周期比 Tt/T1",
			status: TtT1 <= periodLimit ? "pass" : "warning",
			value: TtT1.toFixed(2),
			requirement: `≤ ${periodLimit}（${height > 150 ? "B级高度" : "A级高度"}）`,
			description: TtT1 <= periodLimit ? "扭转周期与平动周期之比满足规范要求，结构抗扭性能良好" : "周期比接近限值，需优化结构布置以减小扭转效应",
			calcChain: {
				basis: "JGJ 3-2010《高层建筑混凝土结构技术规程》第 3.4.5 条 扭转周期与平动周期比限值",
				input: `估算第一平动周期 T1 ≈ ${T1.toFixed(2)}s（经验公式 T1 ≈ 系数×层数）`,
				formula: "Tt/T1 = 经验系数（规则建筑 0.6~0.85）",
				result: `Tt/T1 ≈ ${TtT1.toFixed(2)}，限值 ${periodLimit}`
			},
			clauseText: clauseTemplates.period.clauseText,
			source: clauseTemplates.period.source,
			reason: buildPeriodReason(TtT1 <= periodLimit ? "pass" : "warning", TtT1, periodLimit)
		},
		{
			name: "高度适用范围",
			status: checkHeightApplicability(schemeId, height, intensity) ? "pass" : "warning",
			value: `${height} m`,
			requirement: `≤ ${getHeightLimit(schemeId, intensity)} m（${params.seismicIntensity}度）`,
			description: checkHeightApplicability(schemeId, height, intensity) ? "建筑高度在该结构体系的规范适用范围内" : "建筑高度接近或超出该体系常规适用高度，需进行专门论证",
			calcChain: {
				basis: "GB/T 50011-2010（2024局部修订）表 6.1.1（混凝土）/表 8.1.1（钢结构）/表 7.1.2（砌体）结构体系适用最大高度",
				input: `${schemeName}、${intensity}度设防、建筑高度 ${height}m`,
				formula: "H ≤ H_max(结构体系, 设防烈度)",
				result: `${height}m ≤ ${getHeightLimit(schemeId, intensity)}m`
			},
			clauseText: clauseTemplates.height.clauseText,
			source: clauseTemplates.height.source,
			reason: buildHeightReason(checkHeightApplicability(schemeId, height, intensity) ? "pass" : "warning", height, getHeightLimit(schemeId, intensity), schemeName)
		}
	];
	if (schemeId === "shearwall" || schemeId === "frame-shearwall") {
		const isHighrise = height > 80;
		const isGrade1Nine = intensity >= 9;
		const isGrade1SevenEight = intensity >= 7 && isHighrise;
		let nRatioMin = .35;
		let nRatioMax = .45;
		let limitValue = .6;
		let gradeLabel = "二、三级";
		if (isGrade1Nine) {
			nRatioMin = .35;
			nRatioMax = .42;
			limitValue = .4;
			gradeLabel = "一级（9度）";
		} else if (isGrade1SevenEight) {
			nRatioMin = .4;
			nRatioMax = .48;
			limitValue = .5;
			gradeLabel = "一级（7/8度）";
		} else {
			nRatioMin = .42;
			nRatioMax = .55;
			limitValue = .6;
			gradeLabel = "二、三级";
		}
		const estimated = `${nRatioMin.toFixed(2)}~${nRatioMax.toFixed(2)}`;
		const nRatioAvg = (nRatioMin + nRatioMax) / 2;
		const pass = nRatioMax <= limitValue;
		const nearLimit = nRatioAvg / limitValue > .85;
		checks.push({
			name: "抗震墙墙肢轴压比（估算）",
			status: pass ? nearLimit ? "warning" : "pass" : "fail",
			value: estimated,
			requirement: `≤ ${limitValue.toFixed(2)}（底部加强部位，${gradeLabel}）`,
			description: pass ? "底部加强部位墙肢轴压比满足规范限值要求，有一定安全储备" : "墙肢轴压比接近或超出限值，需加大墙肢截面或提高混凝土强度等级",
			calcChain: {
				basis: "GB/T 50011 第 6.4.2 条 及 GB/T 50010 表 11.7.16 剪力墙轴压比限值",
				input: `${intensity}度设防、房屋高度 ${height}m、底部加强部位、近似抗震等级 ${gradeLabel}`,
				formula: "N/(fc·A)，按经验估算，仅供方案阶段参考",
				result: `估算 ${estimated}，限值 ${limitValue.toFixed(2)}`
			},
			clauseText: clauseTemplates.axialRatio.clauseText,
			source: clauseTemplates.axialRatio.source,
			reason: buildAxialRatioReason(pass ? nearLimit ? "warning" : "pass" : "fail", estimated, limitValue, gradeLabel)
		});
	}
	if (schemeId === "steel") checks.push({
		name: "防火保护",
		status: "warning",
		description: "钢结构构件需做防火涂料保护，柱3h、梁2h耐火极限",
		calcChain: {
			basis: "GB 55037-2022《建筑防火通用规范》（强制性）及 GB 50016-2014（2018年版）第 5.1.2 条",
			input: "钢结构柱、梁、楼板",
			formula: "按建筑高度和耐火等级确定构件耐火极限",
			result: "需防火涂料保护"
		},
		clauseText: "一级耐火等级高层建筑，钢柱耐火极限不应低于 3.00h，钢梁不应低于 2.00h，楼板不应低于 1.50h。钢结构必须采取防火保护措施（如厚涂型/薄涂型防火涂料、防火板包覆等），方可满足规范耐火极限要求。",
		source: "GB 55037-2022《建筑防火通用规范》表 5.2.1 构件耐火极限要求",
		reason: `钢结构自身耐火性能差（约 15min 即失稳），本工程约 ${height}m 高建筑按一级耐火等级设计，钢柱需达到 3h、钢梁 2h 耐火极限，需做防火涂料或防火板包覆，防火保护造价约占结构造价 3~5%。`
	});
	checks.filter((c) => c.status === "pass").length;
	const warnCount = checks.filter((c) => c.status === "warning").length;
	const failCount = checks.filter((c) => c.status === "fail").length;
	let summary = "";
	if (failCount > 0) summary = `有 ${failCount} 项指标不满足规范要求，需重新评估结构方案。`;
	else if (warnCount > 0) summary = `各项主要控制指标基本满足规范要求，有 ${warnCount} 项指标接近限值或需注意，设计中应予关注。`;
	else summary = "各项控制指标均满足规范要求，抗震安全储备充足。";
	summary += " 本计算基于经验公式与简化假定，仅用于方案前期概念比选与决策参考，不构成任何设计依据；实际工程设计必须由注册结构工程师主持，采用专业结构分析软件按现行国家标准逐项复核。";
	return {
		standards,
		checks,
		summary
	};
}
/**
* 各结构体系在不同设防烈度下的适用最大高度（m）
* 依据：GB/T 50011-2010（2024年局部修订）表6.1.1（混凝土结构）、表8.1.1（钢结构）、表7.1.2（砌体）
* 说明：
*   - 未在表中明确单列的体系（钢-混组合、胶合木、空间桁架、装配式）为方案阶段经验参考值
*   - 大跨空间结构以跨度控制为主，高度限值仅供参考
*   - 强制性通用规范 GB 55002-2021 第3.1.3条对适用范围有总体要求
*/
function getHeightLimit(schemeId, intensity) {
	return {
		frame: {
			6: 60,
			7: 50,
			8: 40,
			9: 24
		},
		"frame-shearwall": {
			6: 130,
			7: 120,
			8: 100,
			9: 50
		},
		shearwall: {
			6: 140,
			7: 120,
			8: 100,
			9: 60
		},
		steel: {
			6: 110,
			7: 110,
			8: 90,
			9: 50
		},
		prefabricated: {
			6: 80,
			7: 70,
			8: 60,
			9: 30
		},
		"prefab-steel": {
			6: 110,
			7: 110,
			8: 90,
			9: 50
		},
		composite: {
			6: 130,
			7: 120,
			8: 100,
			9: 50
		},
		masonry: {
			6: 21,
			7: 21,
			8: 18,
			9: 12
		},
		"frame-corewall": {
			6: 150,
			7: 130,
			8: 100,
			9: 70
		},
		"tube-in-tube": {
			6: 180,
			7: 150,
			8: 120,
			9: 80
		},
		"mass-timber": {
			6: 20,
			7: 16,
			8: 12,
			9: 8
		},
		"space-truss": {
			6: 50,
			7: 45,
			8: 35,
			9: 25
		}
	}[schemeId]?.[intensity] || 100;
}
function checkHeightApplicability(schemeId, height, intensity) {
	return height <= getHeightLimit(schemeId, intensity);
}
/**
* 估算工期（月）—— 基于建筑面积、层数、结构体系的经验施工速率模型
*
* 计算模型：
*   工期 = 基础工期 + 面积增量 + 层数增量 + 体系系数 + 场地修正
*
*   - 基础工期：小型项目约 1.5-2.5 个月（场地平整+基础）
*   - 面积增量：按结构体系的月施工面积推算（如现浇框架约 800-1200 ㎡/月层）
*   - 层数增量：高层需考虑流水施工、垂直运输、验收节点，层数>6 后每增加一层加 0.2-0.4 月
*   - 体系系数：框架 1.0 / 框剪 1.15 / 剪力墙 1.2 / 钢结构 0.7（预制快） / 装配式 0.75
*
* 参考工程经验（国内常规施工速度）：
*   - 300 ㎡ 2 层框架办公楼：约 2.5-4 个月
*   - 3000 ㎡ 6 层框架住宅：约 6-9 个月
*   - 10000 ㎡ 18 层框剪住宅：约 12-16 个月
*   - 20000 ㎡ 30 层剪力墙：约 18-24 个月
*   - 钢结构高层比现浇快约 25-35%
*/
function estimateDuration(schemeId, area, floors) {
	const efficiency = {
		frame: 900,
		"frame-shearwall": 780,
		shearwall: 700,
		steel: 1300,
		prefabricated: 1200,
		"prefab-steel": 1400,
		composite: 1e3,
		masonry: 650,
		"frame-corewall": 750,
		"tube-in-tube": 720,
		"mass-timber": 1500,
		"space-truss": 1100
	}[schemeId] || 800;
	let floorArea = Math.max(area / Math.max(floors, 1), 200);
	let floorsPerMonth;
	if (floorArea <= 500) floorsPerMonth = efficiency / (floorArea * 1.2);
	else if (floorArea <= 2e3) floorsPerMonth = efficiency / floorArea;
	else floorsPerMonth = efficiency / floorArea * .85;
	if (floors > 10) {
		const boostSteps = Math.floor((floors - 10) / 5);
		const boostFactor = 1 + Math.min(boostSteps * .1, .6);
		floorsPerMonth *= boostFactor;
	}
	floorsPerMonth = Math.max(floorsPerMonth, .8);
	let mainDuration = floors / floorsPerMonth;
	let foundationMonths;
	if (floors <= 3) foundationMonths = 1.2 + area / 5e3 * .8;
	else if (floors <= 10) foundationMonths = 2 + (floors - 3) * .2;
	else if (floors <= 30) foundationMonths = 3.5 + (floors - 10) * .1;
	else foundationMonths = 5.5 + (floors - 30) * .08;
	let fitoutMonths;
	if (area <= 1e3) fitoutMonths = 1;
	else if (area <= 5e3) fitoutMonths = 1.5 + (area - 1e3) / 8e3;
	else if (area <= 2e4) fitoutMonths = 2 + (area - 5e3) / 1e4;
	else fitoutMonths = 3.5 + (area - 2e4) / 3e4;
	if (schemeId === "steel") fitoutMonths *= .85;
	if (schemeId === "prefabricated") fitoutMonths *= .9;
	const total = foundationMonths + mainDuration + fitoutMonths;
	return Math.max(2, Math.round(total * 10) / 10);
}
/**
* 估算单位面积造价（元/㎡）—— 基于结构体系 + 设防烈度 + 高度 + 场地修正
*
* 参考国内常规建安工程指标（结构主体，不含精装修、设备、土地）：
*   - 多层框架：2500-3500 元/㎡
*   - 高层框剪：3500-5000 元/㎡
*   - 高层剪力墙：4000-5500 元/㎡
*   - 钢结构：5000-7000 元/㎡（含主材）
*   - 装配式：比现浇高 10-20%
*
* 修正因素：
*   - 设防烈度：每提高 1 度，造价增加约 3-5%
*   - 建筑高度：10 层以上每 10 层增加约 3-5%
*   - 场地类别：Ⅲ/Ⅳ类场地基础造价增加 5-10%
*/
function estimateCost(schemeId, floors, intensity, soilCategory, mainSpan = 8) {
	let cost = {
		frame: 2800,
		"frame-shearwall": 3800,
		shearwall: 4400,
		steel: 5500,
		prefabricated: 4200,
		"prefab-steel": 5800,
		composite: 4800,
		masonry: 1800,
		"frame-corewall": 5e3,
		"tube-in-tube": 6e3,
		"mass-timber": 6500,
		"space-truss": 5200
	}[schemeId] || 3e3;
	if (floors > 10) cost *= 1 + (floors - 10) * .005;
	else if (floors < 5) cost *= .92;
	const intensityNum = parseInt(intensity, 10);
	if (!isNaN(intensityNum)) {
		const intensityDiff = intensityNum - 7;
		cost *= 1 + intensityDiff * .09;
	}
	if (mainSpan > 8) cost *= 1 + (mainSpan - 8) * .015;
	if (soilCategory === "Ⅰ") cost *= .97;
	if (soilCategory === "Ⅲ") cost *= 1.05;
	if (soilCategory === "Ⅳ") cost *= 1.1;
	return Math.round(cost);
}
/**
* 构造造价拆解说明（与 estimateCost 计算链保持一致）
*/
function buildCostBreakdown(schemeId, params, finalCost) {
	const baseCost = {
		frame: 2800,
		"frame-shearwall": 3800,
		shearwall: 4400,
		steel: 5500,
		prefabricated: 4200,
		"prefab-steel": 5800,
		composite: 4800,
		masonry: 1800,
		"frame-corewall": 5e3,
		"tube-in-tube": 6e3,
		"mass-timber": 6500,
		"space-truss": 5200
	}[schemeId];
	if (!baseCost) return null;
	const intensityRaw = parseInt(params.seismicIntensity, 10);
	const intensityNum = isNaN(intensityRaw) ? 7 : Math.max(6, Math.min(9, intensityRaw));
	const intensityFactor = 1 + (intensityNum - 7) * .09;
	const heightFactor = params.floors > 10 ? 1 + (params.floors - 10) * .005 : params.floors < 5 ? .92 : 1;
	const soilFactor = params.soilCategory === "Ⅰ" ? .97 : params.soilCategory === "Ⅲ" ? 1.05 : params.soilCategory === "Ⅳ" ? 1.1 : 1;
	const spanFactor = params.mainSpan > 8 ? 1 + (params.mainSpan - 8) * .015 : 1;
	const factors = [{
		name: "结构体系基准",
		coefficient: 1,
		description: `${{
			frame: "框架结构",
			"frame-shearwall": "框架-剪力墙结构",
			shearwall: "剪力墙结构",
			steel: "钢结构",
			prefabricated: "装配式混凝土结构",
			"prefab-steel": "装配式钢结构",
			composite: "钢-混凝土组合结构",
			masonry: "砌体结构",
			"frame-corewall": "框架-核心筒结构",
			"tube-in-tube": "筒中筒结构",
			"mass-timber": "胶合木结构",
			"space-truss": "空间网架/桁架结构"
		}[schemeId] || schemeId}基准造价约 ${baseCost} 元/㎡`
	}];
	if (params.floors > 10) factors.push({
		name: "建筑高度调整",
		coefficient: Number(heightFactor.toFixed(4)),
		description: `${params.floors}层，每增加一层+0.5%`
	});
	else if (params.floors < 5) factors.push({
		name: "低层项目优惠",
		coefficient: .92,
		description: "低层建筑措施费较低"
	});
	if (intensityNum) factors.push({
		name: "设防烈度调整",
		coefficient: Number(intensityFactor.toFixed(4)),
		description: `${params.seismicIntensity}度设防，每度约+9%`
	});
	if (params.soilCategory !== "Ⅱ") factors.push({
		name: "场地类别调整",
		coefficient: Number(soilFactor.toFixed(4)),
		description: `${params.soilCategory}类场地土基础造价调整`
	});
	if (params.mainSpan > 8) factors.push({
		name: "主跨调整",
		coefficient: Number(spanFactor.toFixed(4)),
		description: `主跨 ${params.mainSpan}m，大于 8m 每米+1.5%`
	});
	const compositionMap = {
		frame: [
			{
				category: "混凝土结构主体",
				percentage: 50
			},
			{
				category: "基础工程",
				percentage: 18
			},
			{
				category: "钢筋工程",
				percentage: 15
			},
			{
				category: "模板及脚手架",
				percentage: 10
			},
			{
				category: "措施及其他",
				percentage: 7
			}
		],
		"frame-shearwall": [
			{
				category: "混凝土结构主体",
				percentage: 55
			},
			{
				category: "基础工程",
				percentage: 15
			},
			{
				category: "钢筋工程",
				percentage: 12
			},
			{
				category: "模板及脚手架",
				percentage: 8
			},
			{
				category: "措施及其他",
				percentage: 10
			}
		],
		shearwall: [
			{
				category: "混凝土及钢筋",
				percentage: 60
			},
			{
				category: "基础工程",
				percentage: 18
			},
			{
				category: "模板工程",
				percentage: 10
			},
			{
				category: "脚手架及措施",
				percentage: 7
			},
			{
				category: "其他",
				percentage: 5
			}
		],
		steel: [
			{
				category: "钢材主材",
				percentage: 45
			},
			{
				category: "制作加工",
				percentage: 20
			},
			{
				category: "防火防腐",
				percentage: 12
			},
			{
				category: "安装施工",
				percentage: 13
			},
			{
				category: "基础及其他",
				percentage: 10
			}
		],
		prefabricated: [
			{
				category: "预制构件采购",
				percentage: 55
			},
			{
				category: "现场安装",
				percentage: 15
			},
			{
				category: "基础工程",
				percentage: 12
			},
			{
				category: "灌浆及节点",
				percentage: 10
			},
			{
				category: "措施及其他",
				percentage: 8
			}
		]
	};
	return {
		baseCost,
		range: [Math.round(finalCost * .9), Math.round(finalCost * 1.1)],
		factors,
		composition: compositionMap[schemeId] || compositionMap.frame
	};
}
/**
* 估算装配率（%）—— 按结构体系 + 层数微调
* 依据：GB/T 51129-2017《装配式建筑评价标准》
*   评价等级：P<50% 未达标；50%≤P<60% 基本要求（未达A级）；
*            60%~75% A级；76%~90% AA级；≥91% AAA级
*   计算公式：P = (Q1 + Q2 + Q3) / (100 - Q4) × 100%
* 注：本工具为方案阶段经验估算，正式评价应按标准逐项评分。
*/
function estimatePrecastRate(schemeId, floors = 10) {
	let rate = {
		frame: 22,
		"frame-shearwall": 30,
		shearwall: 40,
		steel: 85,
		prefabricated: 70,
		"prefab-steel": 90,
		composite: 55,
		masonry: 5,
		"frame-corewall": 35,
		"tube-in-tube": 45,
		"mass-timber": 95,
		"space-truss": 80
	}[schemeId] || 15;
	if (schemeId !== "steel" && floors > 20) rate += 8;
	else if (schemeId !== "steel" && floors > 10) rate += 4;
	rate = Math.min(95, Math.round(rate));
	let grade = "未达到装配式建筑装配率要求";
	let gradeCode = "none";
	if (rate >= 91) {
		grade = "AAA级";
		gradeCode = "AAA";
	} else if (rate >= 76) {
		grade = "AA级";
		gradeCode = "AA";
	} else if (rate >= 60) {
		grade = "A级";
		gradeCode = "A";
	} else if (rate >= 50) {
		grade = "达到装配率基本要求（未达A级）";
		gradeCode = "basic";
	}
	return {
		rate,
		grade,
		gradeCode
	};
}
/**
* 估算单位面积碳排放（kgCO2/㎡）
* 依据：GB/T 51366-2019《建筑碳排放计算标准》
*   计算边界：建材生产运输与建造阶段的主体结构隐含碳（阶段划分与边界参照 GB/T 51366-2019）
*   不含运行阶段碳排放
*   数值采用 CLCD / ICE 等碳排放数据库经验均值
*   注：该标准规定计算方法与边界，不规定单位面积限值
*
* 参考数据（中国平均）：
*   - 现浇混凝土框架：500-650 kgCO2/㎡
*   - 现浇剪力墙：600-750 kgCO2/㎡（墙体材料多）
*   - 钢结构：400-550 kgCO2/㎡（钢材隐含碳高但用量少，且可回收）
*   - 装配式混凝土：略低于现浇（减少现场浪费）
*
* 层数修正：层数越高，竖向构件占比增大，单位面积碳排略增
*/
function estimateCarbonEmission(schemeId, floors) {
	let base = {
		frame: 520,
		"frame-shearwall": 580,
		shearwall: 640,
		steel: 460,
		prefabricated: 500,
		"prefab-steel": 420,
		composite: 500,
		masonry: 380,
		"frame-corewall": 620,
		"tube-in-tube": 660,
		"mass-timber": 150,
		"space-truss": 430
	}[schemeId] || 550;
	if (floors > 10) base *= 1 + Math.floor((floors - 10) / 10) * .03;
	if (floors <= 3) base *= .92;
	return Math.round(base);
}
/**
* 施工安全风险等级评估
*/
function estimateConstructionRisk(schemeId, floors) {
	const notes = {
		frame: [
			"高处作业",
			"模板支设",
			"混凝土浇筑"
		],
		"frame-shearwall": [
			"高处作业",
			"脚手架",
			"大体积混凝土"
		],
		shearwall: [
			"高处作业",
			"脚手架",
			"大模板施工",
			"起重吊装"
		],
		steel: [
			"高处作业",
			"起重吊装",
			"焊接作业",
			"高空拼装"
		],
		prefabricated: [
			"起重吊装",
			"构件安装",
			"节点连接"
		],
		"prefab-steel": [
			"起重吊装",
			"高空拼装",
			"焊接作业",
			"构件运输"
		],
		composite: [
			"高处作业",
			"钢混界面施工",
			"起重吊装",
			"混凝土浇筑"
		],
		masonry: [
			"人工砌筑",
			"高处作业",
			"质量控制"
		],
		"frame-corewall": [
			"高处作业",
			"核心筒滑模",
			"外框安装",
			"施工组织复杂"
		],
		"tube-in-tube": [
			"高空作业",
			"巨型构件安装",
			"施工组织极复杂",
			"测量控制"
		],
		"mass-timber": [
			"起重吊装",
			"构件连接",
			"防火处理",
			"防潮控制"
		],
		"space-truss": [
			"高空拼装",
			"起重吊装",
			"焊接作业",
			"整体提升"
		]
	}[schemeId] || [];
	let level = "low";
	if (floors > 10) level = "medium";
	if (floors > 30) level = "high";
	if (schemeId === "steel" && floors > 20) level = "high";
	return {
		level,
		notes
	};
}
/**
* 基础方案建议 - 根据地勘类型和上部结构
*/
function suggestFoundation(schemeId, geologyType, floors, soilCategory) {
	const isHighRise = floors >= 15;
	const isLowRise = floors <= 3;
	let foundationType = "";
	let reason = "";
	const notes = [];
	if (geologyType === "rock") {
		foundationType = "天然地基 + 独立基础/条形基础";
		reason = "岩石地基承载力高，压缩性小，上部结构荷载可直接由天然地基承担";
		notes.push("岩石地基需进行岩体强度和完整性检验");
		notes.push("需注意边坡稳定性及抗浮设计");
		if (isHighRise) {
			foundationType = "岩石锚杆基础 / 桩基础（嵌岩桩）";
			reason = "高层建筑荷载大，需采用嵌岩桩或锚杆基础以提供足够承载力和抗拔力";
		}
	} else if (geologyType === "loess") {
		if (isHighRise) {
			foundationType = "桩基础（灌注桩/预应力管桩）+ 地基处理";
			reason = "湿陷性黄土需消除湿陷性，高层采用桩基础穿透湿陷性土层";
		} else if (isLowRise) {
			foundationType = "强夯法 / 灰土挤密桩地基处理 + 条形基础";
			reason = "低层建筑可采用地基处理消除湿陷性，降低造价";
		} else {
			foundationType = "CFG桩复合地基 / 桩基础";
			reason = "中高层建筑需根据湿陷等级选用复合地基或桩基础";
		}
		notes.push("需进行湿陷性等级评价（Ⅰ~Ⅳ级）");
		notes.push("应做好场地排水，防止雨水下渗");
		notes.push("基础埋深应大于大气影响深度");
	} else if (geologyType === "clay") {
		if (isHighRise) {
			foundationType = "桩基础（钻孔灌注桩 / 预应力管桩）";
			reason = "高层建筑荷载较大，一般黏土需采用桩基础，桩端进入较好持力层";
		} else {
			foundationType = "天然地基 + 筏板基础 / 条形基础";
			reason = "一般黏土承载力中等，多层建筑可采用天然地基方案";
		}
		notes.push("需注意软弱下卧层验算");
		notes.push("关注地基沉降和不均匀沉降控制");
	} else {
		foundationType = "桩基础 / 复合地基（需专项论证）";
		reason = "填土地基均匀性差，承载力低，需进行地基处理或采用桩基础穿透填土层";
		notes.push("填土成分复杂，需详细勘察查明填土性质和厚度");
		notes.push("建议进行专项地基方案论证");
		notes.push("需特别关注工后沉降问题");
	}
	if (schemeId === "steel") notes.push("钢结构自重较轻，对基础承载力要求相对较低");
	if (schemeId === "shearwall") notes.push("剪力墙结构自重较大，基础底板配筋率相应提高");
	return {
		foundationType,
		reason,
		notes
	};
}
var STRUCTURE_SYSTEM_LIBRARY = [
	{
		id: "frame",
		name: "框架结构",
		description: "框架结构是由梁和柱以刚接或铰接相连接而成的承重结构体系，竖向荷载和水平荷载均由框架承担。",
		applicableScenarios: "适用于10层以下的多层住宅、办公楼、教学楼、商场等建筑，建筑平面布置灵活，空间开阔。",
		advantages: [
			"建筑平面布置灵活，可获得较大使用空间",
			"构造简单，施工方便，造价较低",
			"技术成熟，设计经验丰富",
			"改建、扩建相对容易"
		],
		disadvantages: [
			"侧向刚度较小，层数受限制",
			"抗震性能不如剪力墙结构",
			"柱截面较大，影响建筑使用面积",
			"高烈度地区适用高度有限"
		],
		metrics: {
			cost: 2800,
			duration: 12,
			seismicPerformance: 6.5,
			constructionDifficulty: 5,
			sustainability: 6,
			precastRate: {
				rate: 22,
				grade: "未达到装配式建筑装配率要求",
				gradeCode: "none"
			},
			carbonEmission: 520,
			safetyRisk: "medium"
		}
	},
	{
		id: "frame-shearwall",
		name: "框架-剪力墙结构",
		description: "框架-剪力墙结构是在框架结构中设置适当剪力墙的结构体系，兼具框架结构布置灵活和剪力墙刚度大的优点。",
		applicableScenarios: "适用于10-40层的高层住宅、办公楼、酒店等，需要灵活空间同时对抗震有较高要求的项目。",
		advantages: [
			"建筑平面布置灵活，可获得较大使用空间",
			"抗震性能优异，侧向刚度大，层间位移小",
			"技术成熟，施工经验丰富",
			"经济性较好，造价比纯剪力墙结构低"
		],
		disadvantages: [
			"剪力墙布置影响建筑平面功能布局",
			"结构计算相对复杂，需专业软件分析",
			"施工工序较多，周期略长于纯框架"
		],
		metrics: {
			cost: 3800,
			duration: 16,
			seismicPerformance: 8.5,
			constructionDifficulty: 6.5,
			sustainability: 7,
			precastRate: {
				rate: 30,
				grade: "未达到装配式建筑装配率要求",
				gradeCode: "none"
			},
			carbonEmission: 580,
			safetyRisk: "medium"
		}
	},
	{
		id: "shearwall",
		name: "剪力墙结构",
		description: "剪力墙结构是利用建筑物的墙体作为主要承重和抗侧力构件的结构体系，墙体同时承担竖向荷载和水平荷载。",
		applicableScenarios: "适用于15-50层的高层住宅、公寓等，特别适合抗震设防烈度较高地区的住宅类项目。",
		advantages: [
			"侧向刚度大，抗震性能优异",
			"墙体同时作为分隔墙，建筑功能与结构统一",
			"结构整体性好，安全储备高",
			"适合标准化设计和工业化施工"
		],
		disadvantages: [
			"建筑平面布置受限，空间灵活性差",
			"自重大，基础造价较高",
			"剪力墙开洞受限，影响建筑造型",
			"材料用量较大，造价偏高"
		],
		metrics: {
			cost: 4400,
			duration: 20,
			seismicPerformance: 9.2,
			constructionDifficulty: 6,
			sustainability: 6.5,
			precastRate: {
				rate: 40,
				grade: "未达到装配式建筑装配率要求",
				gradeCode: "none"
			},
			carbonEmission: 640,
			safetyRisk: "medium"
		}
	},
	{
		id: "steel",
		name: "钢结构",
		description: "钢结构是以钢材为主要承重构件的结构体系，具有强度高、自重轻、塑性韧性好、施工速度快等优点。",
		applicableScenarios: "适用于大跨度、超高层、造型复杂的建筑，如体育馆、会展中心、超高层办公楼等。",
		advantages: [
			"强度高，自重轻，抗震性能好",
			"工厂预制，现场装配，施工速度快",
			"建筑造型灵活，适合复杂曲面和大跨度",
			"钢材可回收利用，绿色环保"
		],
		disadvantages: [
			"造价较高，材料成本大",
			"防火性能差，需做防火处理",
			"防腐维护成本高",
			"对施工精度和焊接质量要求高"
		],
		metrics: {
			cost: 5500,
			duration: 14,
			seismicPerformance: 8.8,
			constructionDifficulty: 7.5,
			sustainability: 8.5,
			precastRate: {
				rate: 85,
				grade: "AA级",
				gradeCode: "AA"
			},
			carbonEmission: 460,
			safetyRisk: "high"
		}
	},
	{
		id: "prefabricated",
		name: "装配式混凝土结构(PC)",
		description: "装配式混凝土结构（PC）是将部分或全部混凝土构件在工厂预制，运输到现场进行装配的结构体系，是建筑工业化的核心方向。",
		applicableScenarios: "适用于标准化程度高的住宅、公寓、学校、保障房等项目，尤其适合政府推广装配式建筑的地区。",
		advantages: [
			"工厂预制，质量稳定可控",
			"现场湿作业少，施工速度快",
			"减少现场扬尘和噪音，绿色环保",
			"受季节天气影响小，工期可控"
		],
		disadvantages: [
			"建造成本略高于现浇（运输+吊装费用）",
			"节点连接是关键技术难点",
			"对预制构件生产设备要求高",
			"建筑平面标准化要求较高"
		],
		metrics: {
			cost: 4200,
			duration: 14,
			seismicPerformance: 7.8,
			constructionDifficulty: 6,
			sustainability: 8,
			precastRate: {
				rate: 70,
				grade: "A级",
				gradeCode: "A"
			},
			carbonEmission: 500,
			safetyRisk: "medium"
		}
	},
	{
		id: "prefab-steel",
		name: "装配式钢结构",
		description: "装配式钢结构是钢结构与装配式建造方式的深度结合，所有构件工厂预制、现场螺栓/焊接装配，工业化程度最高。",
		applicableScenarios: "适用于超高层办公楼、大跨度场馆、装配式住宅、模块化建筑等，对工期要求紧的项目尤其适用。",
		advantages: [
			"工业化程度最高，施工速度最快",
			"自重轻，基础造价低",
			"抗震性能优异，延性好",
			"钢材可回收，全生命周期绿色"
		],
		disadvantages: [
			"单位造价较高",
			"防火防腐要求高，维护成本大",
			"对加工精度和安装精度要求极高",
			"隔声隔热性能需专项处理"
		],
		metrics: {
			cost: 5800,
			duration: 10,
			seismicPerformance: 9,
			constructionDifficulty: 7,
			sustainability: 9,
			precastRate: {
				rate: 90,
				grade: "AA级",
				gradeCode: "AA"
			},
			carbonEmission: 420,
			safetyRisk: "high"
		}
	},
	{
		id: "composite",
		name: "钢-混凝土组合结构",
		description: "钢-混凝土组合结构充分发挥钢材抗拉和混凝土抗压的各自优势，常见形式有钢骨混凝土、钢管混凝土、组合梁等。",
		applicableScenarios: "适用于高层和超高层建筑、大跨度结构、转换层结构等，对刚度和承载力都有较高要求的项目。",
		advantages: [
			"充分发挥钢与混凝土两种材料的优势",
			"承载力高，截面小，增加使用面积",
			"抗震性能好，延性优于纯混凝土结构",
			"耐火性能优于纯钢结构"
		],
		disadvantages: [
			"构造复杂，施工难度大",
			"造价较高，介于钢结构与混凝土结构之间",
			"节点构造复杂，设计难度大",
			"对施工工艺和质量控制要求高"
		],
		metrics: {
			cost: 4800,
			duration: 16,
			seismicPerformance: 8.8,
			constructionDifficulty: 8,
			sustainability: 7.5,
			precastRate: {
				rate: 55,
				grade: "达到装配率基本要求（未达A级）",
				gradeCode: "basic"
			},
			carbonEmission: 500,
			safetyRisk: "high"
		}
	},
	{
		id: "masonry",
		name: "砌体结构",
		description: "砌体结构是由块材（砖、砌块、石材等）通过砂浆砌筑而成的结构体系，是最传统也是最经济的结构形式之一。",
		applicableScenarios: "适用于7层以下的多层住宅、宿舍、办公楼、小型商业等，尤其适合造价敏感的乡镇和三四线城市项目。",
		advantages: [
			"造价低廉，经济性最好",
			"材料易得，施工技术门槛低",
			"隔声隔热性能好，居住舒适度高",
			"维护成本低，耐久性好"
		],
		disadvantages: [
			"抗震性能差，适用高度有限",
			"自重大，对地基承载力要求高",
			"砌筑劳动强度大，工业化程度低",
			"墙体拆除改造困难"
		],
		metrics: {
			cost: 1800,
			duration: 10,
			seismicPerformance: 4,
			constructionDifficulty: 3,
			sustainability: 5.5,
			precastRate: {
				rate: 5,
				grade: "未达到装配式建筑装配率要求",
				gradeCode: "none"
			},
			carbonEmission: 380,
			safetyRisk: "low"
		}
	},
	{
		id: "frame-corewall",
		name: "框架-核心筒结构",
		description: "框架-核心筒结构是由中央钢筋混凝土核心筒和外围框架组成的结构体系，是目前超高层建筑最常用的结构形式之一。",
		applicableScenarios: "适用于40-80层的超高层办公楼、酒店、公寓等，建筑高度100-200m的超高层项目。",
		advantages: [
			"抗侧刚度大，适用高度高",
			"核心筒集中布置交通核，建筑功能合理",
			"外围柱距大，办公空间开阔灵活",
			"抗震性能好，两道抗震防线"
		],
		disadvantages: [
			"结构计算复杂，需专项分析",
			"造价较高，施工难度大",
			"核心筒面积占比较大，得房率略低",
			"施工周期长，技术要求高"
		],
		metrics: {
			cost: 5e3,
			duration: 28,
			seismicPerformance: 9,
			constructionDifficulty: 8.5,
			sustainability: 7,
			precastRate: {
				rate: 35,
				grade: "未达到装配式建筑装配率要求",
				gradeCode: "none"
			},
			carbonEmission: 620,
			safetyRisk: "high"
		}
	},
	{
		id: "tube-in-tube",
		name: "筒中筒结构",
		description: "筒中筒结构由内筒（通常为剪力墙核心筒）和外筒（密柱深梁框筒或支撑框筒）组成，两个筒体共同抵抗水平荷载。",
		applicableScenarios: "适用于60层以上的超高层建筑（200-400m），如地标性超高层办公楼、酒店、综合体等。",
		advantages: [
			"空间整体受力，抗侧刚度极大",
			"适用高度最高，可达400m以上",
			"抗震抗风性能优异，扭转刚度大",
			"建筑造型挺拔，立面美观"
		],
		disadvantages: [
			"造价极高，结构材料用量大",
			"设计难度极大，需复杂分析",
			"施工难度高，周期长",
			"外围密柱影响立面开窗和视线"
		],
		metrics: {
			cost: 6e3,
			duration: 36,
			seismicPerformance: 9.5,
			constructionDifficulty: 9.5,
			sustainability: 6.5,
			precastRate: {
				rate: 45,
				grade: "未达到装配式建筑装配率要求",
				gradeCode: "none"
			},
			carbonEmission: 660,
			safetyRisk: "high"
		}
	},
	{
		id: "mass-timber",
		name: "胶合木结构",
		description: "胶合木结构（Mass Timber）是以工程木产品（CLT正交胶合木、Glulam胶合木等）为主要承重构件的现代木结构体系。",
		applicableScenarios: "适用于8层以下的低层/多层住宅、办公楼、学校、文旅建筑等，特别适合追求绿色低碳、亲近自然的项目。",
		advantages: [
			"碳排放最低，真正的绿色低碳建筑",
			"工厂预制，现场拼装，施工速度快",
			"建筑美学好，室内空间温暖自然",
			"自重轻，基础造价低，抗震性能好"
		],
		disadvantages: [
			"造价较高，木材材料成本大",
			"防火设计要求高（需阻燃处理）",
			"适用高度有限（国内规范10层/30m以下）",
			"防腐防潮需专项设计"
		],
		metrics: {
			cost: 6500,
			duration: 10,
			seismicPerformance: 7.5,
			constructionDifficulty: 6.5,
			sustainability: 10,
			precastRate: {
				rate: 95,
				grade: "AAA级",
				gradeCode: "AAA"
			},
			carbonEmission: 150,
			safetyRisk: "medium"
		}
	},
	{
		id: "space-truss",
		name: "空间结构(网架/桁架)",
		description: "空间结构包括网架、网壳、桁架、悬索、膜结构等形式，具有受力合理、跨度大、自重轻、造型丰富等特点。",
		applicableScenarios: "适用于大跨度公共建筑，如体育馆、会展中心、航站楼、高铁站房、大型厂房等跨度30m以上的项目。",
		advantages: [
			"跨越能力强，可实现超大跨度",
			"自重轻，材料利用率高",
			"造型丰富美观，建筑表现力强",
			"工厂预制，现场拼装，工期可控"
		],
		disadvantages: [
			"节点构造复杂，加工精度要求高",
			"屋面系统造价较高",
			"防火防腐要求高",
			"对支座沉降敏感"
		],
		metrics: {
			cost: 5200,
			duration: 12,
			seismicPerformance: 7,
			constructionDifficulty: 8,
			sustainability: 8,
			precastRate: {
				rate: 80,
				grade: "AA级",
				gradeCode: "AA"
			},
			carbonEmission: 430,
			safetyRisk: "high"
		}
	}
];
function generateSchemesFromParams(params) {
	const height = calculateBuildingHeight(params.floors);
	const parsedIntensity = parseInt(params.seismicIntensity, 10);
	const intensity = isNaN(parsedIntensity) ? 7 : Math.max(6, Math.min(9, parsedIntensity));
	const isLowRise = params.floors <= 6;
	params.floors > 6 && params.floors;
	params.floors > 18 && params.floors;
	const isSuperHighRise = params.floors > 40;
	const isLargeSpan = params.mainSpan >= 18;
	const isGreenFocus = params.buildingType === "school" || params.buildingType === "gymnasium";
	const scored = STRUCTURE_SYSTEM_LIBRARY.map((scheme) => {
		let score = 50;
		const heightLimit = getHeightLimit(scheme.id, intensity);
		const heightRatio = height / heightLimit;
		if (heightRatio > 1) score -= 40 + (heightRatio - 1) * 50;
		else if (heightRatio > .9) score += 5;
		else if (heightRatio > .5) score += 15;
		else if (heightRatio > .2) score += 8;
		else score -= 5;
		const typeRank = ({
			residential: [
				"shearwall",
				"frame-shearwall",
				"prefabricated",
				"frame",
				"masonry",
				"frame-corewall",
				"tube-in-tube"
			],
			office: [
				"frame-shearwall",
				"frame-corewall",
				"tube-in-tube",
				"composite",
				"steel",
				"prefab-steel",
				"frame"
			],
			school: [
				"frame",
				"masonry",
				"prefabricated",
				"frame-shearwall",
				"mass-timber",
				"steel"
			],
			factory: [
				"steel",
				"prefab-steel",
				"space-truss",
				"frame",
				"composite"
			],
			gymnasium: [
				"space-truss",
				"steel",
				"prefab-steel",
				"composite",
				"mass-timber"
			]
		}[params.buildingType] || []).indexOf(scheme.id);
		if (typeRank === 0) score += 15;
		else if (typeRank === 1) score += 12;
		else if (typeRank === 2) score += 9;
		else if (typeRank === 3) score += 6;
		else if (typeRank === 4) score += 3;
		else if (typeRank >= 0) score += 1;
		else score -= 8;
		if (isLargeSpan) {
			if (scheme.id === "space-truss") score += 20;
			else if (scheme.id === "steel" || scheme.id === "prefab-steel") score += 15;
			else if (scheme.id === "composite") score += 8;
			else if (scheme.id === "frame") score -= 5;
			else if (scheme.id === "masonry") score -= 15;
		}
		const budgetRatio = estimateCost(scheme.id, params.floors, params.seismicIntensity, params.soilCategory, params.mainSpan) / params.budget;
		if (budgetRatio <= .7) score += 8;
		else if (budgetRatio <= .9) score += 12;
		else if (budgetRatio <= 1) score += 8;
		else if (budgetRatio <= 1.1) score -= 5;
		else if (budgetRatio <= 1.3) score -= 15;
		else score -= 30;
		if (intensity >= 9) {
			if ([
				"shearwall",
				"frame-shearwall",
				"frame-corewall",
				"tube-in-tube",
				"composite"
			].includes(scheme.id)) score += 10;
			if (scheme.id === "masonry") score -= 20;
			if (scheme.id === "mass-timber") score -= 10;
		} else if (intensity >= 8) {
			if ([
				"shearwall",
				"frame-shearwall",
				"frame-corewall"
			].includes(scheme.id)) score += 6;
		} else {
			if (scheme.id === "masonry") score += 8;
			if (scheme.id === "frame") score += 4;
		}
		if (isGreenFocus) {
			if (scheme.id === "mass-timber") score += 10;
			if (scheme.id === "prefabricated" || scheme.id === "prefab-steel") score += 5;
			if (scheme.id === "steel" || scheme.id === "composite") score += 3;
		}
		if (params.soilCategory === "Ⅳ") {
			if ([
				"steel",
				"prefab-steel",
				"mass-timber"
			].includes(scheme.id)) score += 5;
			if ([
				"masonry",
				"shearwall",
				"tube-in-tube"
			].includes(scheme.id)) score -= 5;
		}
		if (isLowRise) {
			if (scheme.id === "masonry") score += 12;
			if (scheme.id === "mass-timber") score += 8;
			if (scheme.id === "frame") score += 5;
			if (["tube-in-tube", "frame-corewall"].includes(scheme.id)) score -= 15;
		}
		if (isSuperHighRise) {
			if (scheme.id === "tube-in-tube") score += 15;
			if (scheme.id === "frame-corewall") score += 12;
			if (scheme.id === "composite") score += 8;
			if ([
				"frame",
				"masonry",
				"mass-timber",
				"space-truss"
			].includes(scheme.id)) score -= 20;
		}
		return {
			scheme,
			score
		};
	});
	let candidates = scored;
	if (params.structurePreference && params.structurePreference !== "any") {
		const pref = params.structurePreference;
		candidates = scored.filter((s) => s.scheme.id === pref);
		if (candidates.length === 0) candidates = scored;
	}
	candidates.sort((a, b) => b.score - a.score);
	let top3 = candidates.slice(0, 3);
	if (top3.length < 2) {
		const existingIds = new Set(top3.map((t) => t.scheme.id));
		const remaining = scored.filter((s) => !existingIds.has(s.scheme.id));
		remaining.sort((a, b) => b.score - a.score);
		while (top3.length < 2 && remaining.length > 0) {
			const next = remaining.shift();
			top3.push(next);
		}
	}
	if (params.buildingType === "residential" && intensity >= 8 && height >= 30) {
		const seismicWallIds = [
			"shearwall",
			"frame-shearwall",
			"frame-corewall",
			"tube-in-tube"
		];
		top3 = top3.map((item) => {
			if (seismicWallIds.includes(item.scheme.id)) return {
				...item,
				score: item.score + 8
			};
			return item;
		});
		top3.sort((a, b) => b.score - a.score);
	}
	return top3.map(({ scheme }) => {
		const cost = estimateCost(scheme.id, params.floors, params.seismicIntensity, params.soilCategory, params.mainSpan);
		const duration = estimateDuration(scheme.id, params.area, params.floors);
		const carbonEmission = estimateCarbonEmission(scheme.id, params.floors);
		const precastRate = estimatePrecastRate(scheme.id, params.floors);
		const risk = estimateConstructionRisk(scheme.id, params.floors);
		const costBreakdown = buildCostBreakdown(scheme.id, params, cost);
		return {
			...scheme,
			metrics: {
				...scheme.metrics,
				cost,
				duration,
				carbonEmission,
				precastRate,
				safetyRisk: risk.level
			},
			normCompliance: calculateNormCompliance(scheme.id, params),
			foundationSuggestion: suggestFoundation(scheme.id, params.geologyType, params.floors, params.soilCategory),
			safetyRiskNotes: risk.notes,
			...costBreakdown && { costBreakdown }
		};
	});
}
//#endregion
//#region src/agent/scoring.ts
/** 各维度行业典型参考范围（用于固定归一化） */
var SCORE_RANGES = {
	cost: {
		min: 2e3,
		max: 6e3
	},
	duration: {
		min: 6,
		max: 36
	},
	difficulty: {
		min: 1,
		max: 10
	},
	carbon: {
		min: 200,
		max: 1e3
	},
	seismic: {
		min: 0,
		max: 10
	},
	sustain: {
		min: 0,
		max: 10
	},
	precast: {
		min: 0,
		max: 100
	}
};
/**
* 固定范围归一化（0~10 分）
* @param lowerIsBetter true = 值越小分越高（逆向）
*/
function normalizeMetric(value, min, max, lowerIsBetter) {
	const norm = (Math.min(max, Math.max(min, value)) - min) / (max - min);
	const score = (lowerIsBetter ? 1 - norm : norm) * 10;
	return Math.round(score * 100) / 100;
}
/** 统一综合评分：对任意方案 + 任意权重，输出唯一确定的 0~10 分及各分项 */
function computeSchemeScore(scheme, weights) {
	const m = scheme.metrics;
	const costScore = normalizeMetric(m.cost, SCORE_RANGES.cost.min, SCORE_RANGES.cost.max, true);
	const durationScore = normalizeMetric(m.duration, SCORE_RANGES.duration.min, SCORE_RANGES.duration.max, true);
	const seismicScore = normalizeMetric(m.seismicPerformance, SCORE_RANGES.seismic.min, SCORE_RANGES.seismic.max, false);
	const difficultyScore = normalizeMetric(m.constructionDifficulty, SCORE_RANGES.difficulty.min, SCORE_RANGES.difficulty.max, true);
	const sustainScore = normalizeMetric(m.sustainability, SCORE_RANGES.sustain.min, SCORE_RANGES.sustain.max, false);
	const carbonScore = normalizeMetric(m.carbonEmission, SCORE_RANGES.carbon.min, SCORE_RANGES.carbon.max, true);
	const precastScore = normalizeMetric(m.precastRate.rate, SCORE_RANGES.precast.min, SCORE_RANGES.precast.max, false);
	const safetyScore = Math.round((seismicScore * .6 + difficultyScore * .4) * 100) / 100;
	const greenScore = Math.round((sustainScore * .4 + carbonScore * .35 + precastScore * .25) * 100) / 100;
	const performanceScore = Math.round((seismicScore + sustainScore) / 2 * 100) / 100;
	const weightTotal = weights.cost + weights.duration + weights.safety + weights.green || 100;
	const overall = (costScore * weights.cost + durationScore * weights.duration + safetyScore * weights.safety + greenScore * weights.green) / weightTotal;
	return {
		cost: costScore,
		duration: durationScore,
		seismic: seismicScore,
		difficulty: difficultyScore,
		sustain: sustainScore,
		carbon: carbonScore,
		precast: precastScore,
		safety: safetyScore,
		green: greenScore,
		performance: performanceScore,
		overall: Math.round(overall * 100) / 100
	};
}
//#endregion
//#region src/agent/tools.ts
var TOOL_REGISTRY = [
	{
		name: "query_structure_systems",
		description: "从12类结构体系库中按高度、建筑类型、跨度、预算、烈度等8维条件筛选，返回候选方案池（含体系名、id、适用性评分）。用于方案选型初期快速确定备选体系。",
		parameters: {
			type: "object",
			properties: {
				filters: {
					type: "object",
					description: "筛选条件，与 IProjectParams 字段一致，至少提供建筑类型、层数、设防烈度",
					properties: {
						buildingType: {
							type: "string",
							description: "建筑类型：residential/office/school/factory/gymnasium",
							enum: [
								"residential",
								"office",
								"school",
								"factory",
								"gymnasium"
							]
						},
						floors: {
							type: "number",
							description: "建筑层数"
						},
						area: {
							type: "number",
							description: "建筑面积（㎡）"
						},
						seismicIntensity: {
							type: "string",
							description: "抗震设防烈度：6/7/8/9",
							enum: [
								"6",
								"7",
								"8",
								"9"
							]
						},
						soilCategory: {
							type: "string",
							description: "场地土类别：Ⅰ/Ⅱ/Ⅲ/Ⅳ",
							enum: [
								"Ⅰ",
								"Ⅱ",
								"Ⅲ",
								"Ⅳ"
							]
						},
						mainSpan: {
							type: "number",
							description: "主要跨度（米）"
						},
						budget: {
							type: "number",
							description: "单位面积预算（元/㎡）"
						},
						structurePreference: {
							type: "string",
							description: "结构体系偏好，any 表示不限",
							enum: [
								"any",
								"frame",
								"frame-shearwall",
								"shearwall",
								"steel",
								"prefabricated"
							]
						}
					},
					required: [
						"buildingType",
						"floors",
						"seismicIntensity"
					]
				},
				topN: {
					type: "integer",
					description: "返回前 N 个候选，默认 3"
				}
			},
			required: ["filters"]
		},
		allowedAgents: ["architect", "chief"],
		executor: (args) => {
			const filters = args.filters;
			const topN = args.topN || 3;
			const result = generateSchemesFromParams({
				buildingType: filters.buildingType || "residential",
				floors: Number(filters.floors) || 10,
				area: Number(filters.area) || 5e3,
				structurePreference: filters.structurePreference || "any",
				seismicIntensity: filters.seismicIntensity || "7",
				soilCategory: filters.soilCategory || "Ⅱ",
				geologyType: "clay",
				mainSpan: Number(filters.mainSpan) || 8,
				budget: Number(filters.budget) || 4e3,
				windPressure: filters.windPressure || "0.4",
				snowPressure: filters.snowPressure || "0.2",
				fortificationCategory: filters.fortificationCategory || "standard"
			});
			return {
				total: result.length,
				candidates: result.slice(0, topN).map((s) => ({
					id: s.id,
					name: s.name,
					description: s.description,
					applicableScenarios: s.applicableScenarios,
					advantages: s.advantages,
					disadvantages: s.disadvantages
				}))
			};
		}
	},
	{
		name: "check_seismic_requirements",
		description: "抗震规范校核：按 GB 55002-2021 / GB/T 50011 验算最大适用高度、弹性层间位移角、剪重比、周期比、轴压比（剪力墙体系），返回逐条 { code, clause, limit, actual, status } 判定。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID（如 frame / shearwall / steel / frame-shearwall 等）"
				},
				params: {
					type: "object",
					description: "工程参数",
					properties: {
						floors: {
							type: "number",
							description: "层数"
						},
						seismicIntensity: {
							type: "string",
							description: "设防烈度：6/7/8/9"
						},
						soilCategory: {
							type: "string",
							description: "场地土类别：Ⅰ/Ⅱ/Ⅲ/Ⅳ"
						},
						buildingType: {
							type: "string",
							description: "建筑类型"
						}
					},
					required: ["floors", "seismicIntensity"]
				}
			},
			required: ["systemId", "params"]
		},
		allowedAgents: ["code", "chief"],
		executor: (args) => {
			const systemId = args.systemId;
			const p = args.params;
			const params = {
				buildingType: p.buildingType || "residential",
				floors: Number(p.floors) || 10,
				area: 5e3,
				structurePreference: "any",
				seismicIntensity: p.seismicIntensity || "7",
				soilCategory: p.soilCategory || "Ⅱ",
				geologyType: "clay",
				mainSpan: 8,
				budget: 4e3,
				windPressure: p.windPressure || "0.4",
				snowPressure: p.snowPressure || "0.2",
				fortificationCategory: p.fortificationCategory || "standard"
			};
			const result = calculateNormCompliance(systemId, params);
			return {
				systemId,
				systemName: STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId,
				height: calculateBuildingHeight(params.floors),
				standards: result.standards,
				checks: result.checks.map((c) => ({
					name: c.name,
					status: c.status,
					value: c.value,
					requirement: c.requirement,
					description: c.description,
					basis: c.calcChain?.basis,
					formula: c.calcChain?.formula,
					input: c.calcChain?.input,
					clauseText: c.clauseText,
					reason: c.reason,
					source: c.source
				})),
				summary: result.summary,
				passCount: result.checks.filter((c) => c.status === "pass").length,
				warningCount: result.checks.filter((c) => c.status === "warning").length,
				failCount: result.checks.filter((c) => c.status === "fail").length
			};
		}
	},
	{
		name: "check_fire_requirements",
		description: "防火规范校核：按 GB 55037-2022 建筑防火通用规范校验结构体系的耐火等级、构件耐火极限要求。钢结构需重点关注防火涂料保护要求。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				height: {
					type: "number",
					description: "建筑高度（米），可选，不传则按层数推算"
				},
				floors: {
					type: "number",
					description: "建筑层数"
				},
				buildingType: {
					type: "string",
					description: "建筑类型"
				}
			},
			required: ["systemId", "floors"]
		},
		allowedAgents: ["code"],
		executor: (args) => {
			const systemId = args.systemId;
			const floors = Number(args.floors) || 10;
			const height = args.height ? Number(args.height) : calculateBuildingHeight(floors);
			const buildingType = args.buildingType || "residential";
			const systemName = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId;
			const isHighRise = height > 24;
			const fireResistanceGrade = isHighRise ? "一级" : "二级";
			const fireChecks = [];
			fireChecks.push({
				item: "耐火等级",
				requirement: fireResistanceGrade,
				status: "pass",
				note: `${isHighRise ? "高层建筑" : "多层建筑"}按 GB 55037-2022 第 5.1.3 条确定耐火等级为${fireResistanceGrade}`
			});
			if (systemId === "steel" || systemId === "prefab-steel") {
				fireChecks.push({
					item: "钢柱耐火极限",
					requirement: "≥ 3.00 h（一级）/ ≥ 2.50 h（二级）",
					status: "warning",
					note: "钢结构柱需做防火涂料/防火板保护，达到 GB 55037-2022 表 5.2.1 柱耐火极限要求",
					clauseText: "一级耐火等级高层建筑，钢柱耐火极限不应低于 3.00h；二级耐火等级不应低于 2.50h。钢结构柱必须采取防火保护措施方可满足规范耐火极限要求。",
					reason: "钢柱为竖向承重构件，火灾下一旦失稳将导致结构整体倒塌，因此耐火极限要求最高。采用厚涂型防火涂料（约30~50mm）或防火板包覆可达到 3.00h 要求。",
					source: "GB 55037-2022《建筑防火通用规范》表 5.2.1"
				});
				fireChecks.push({
					item: "钢梁耐火极限",
					requirement: "≥ 2.00 h（一级）/ ≥ 1.50 h（二级）",
					status: "warning",
					note: "钢梁需做防火涂料保护，推荐超薄型或薄型防火涂料",
					clauseText: "一级耐火等级高层建筑，钢梁耐火极限不应低于 2.00h；二级耐火等级不应低于 1.50h。钢梁为水平承重构件，需做防火保护。",
					reason: "钢梁耐火极限要求略低于柱，工程中常用薄涂型或超薄型膨胀型防火涂料，涂层厚度较小，兼顾经济与外观。",
					source: "GB 55037-2022《建筑防火通用规范》表 5.2.1"
				});
				fireChecks.push({
					item: "楼板耐火极限",
					requirement: "≥ 1.50 h（一级）/ ≥ 1.00 h（二级）",
					status: "pass",
					note: "钢楼承板+现浇混凝土组合楼板通常可满足要求",
					clauseText: "一级耐火等级高层建筑，楼板耐火极限不应低于 1.50h；二级不应低于 1.00h。压型钢板+现浇混凝土组合楼板通常可满足要求。",
					reason: "组合楼板因下部有压型钢板与上部现浇混凝土共同作用，混凝土层本身具有较好耐火性能，一般无需额外做底部防火涂料。",
					source: "GB 55037-2022《建筑防火通用规范》表 5.2.1"
				});
			} else if (systemId === "masonry") fireChecks.push({
				item: "承重墙耐火极限",
				requirement: "≥ 3.00 h（一级）",
				status: "pass",
				note: "砌体墙耐火性能优异，240mm 厚普通黏土砖墙耐火极限约 5.5h"
			});
			else if (systemId === "mass-timber") fireChecks.push({
				item: "木构件耐火极限",
				requirement: "按建筑高度和功能确定",
				status: "warning",
				note: "胶合木结构需按 GB 55037-2022 第 5.3 节木结构建筑规定确定耐火极限"
			});
			else fireChecks.push({
				item: "混凝土构件耐火极限",
				requirement: "墙/柱≥3.0h、梁≥2.0h、板≥1.5h（一级）",
				status: "pass",
				note: "钢筋混凝土构件通常具有良好的耐火性能，满足规范要求"
			});
			return {
				systemId,
				systemName,
				buildingType,
				height,
				fireResistanceGrade,
				codeBasis: ["GB 55037-2022《建筑防火通用规范》", "GB 50016-2014（2018年版）《建筑设计防火规范》"],
				checks: fireChecks.map((c) => ({
					article: c.item,
					status: c.status,
					requirement: c.requirement,
					note: c.note,
					clauseText: c.clauseText,
					reason: c.reason,
					source: c.source
				})),
				items: fireChecks.map((c) => ({
					article: c.item,
					status: c.status,
					requirement: c.requirement,
					note: c.note,
					clauseText: c.clauseText,
					reason: c.reason,
					source: c.source
				})),
				summary: systemId === "steel" || systemId === "prefab-steel" || systemId === "mass-timber" ? `该结构体系（${systemName}）防火性能需专项设计，钢结构需做防火涂料保护，木结构需满足木结构建筑防火专项要求。` : `该结构体系（${systemName}）具有良好的耐火性能，按${fireResistanceGrade}耐火等级设计即可满足 GB 55037-2022 要求。`,
				passCount: fireChecks.filter((c) => c.status === "pass").length,
				warningCount: fireChecks.filter((c) => c.status === "warning").length,
				failCount: fireChecks.filter((c) => c.status === "fail").length
			};
		}
	},
	{
		name: "estimate_cost",
		description: "结构主体造价估算（元/㎡），按结构体系基准造价 + 设防烈度修正 + 高度修正 + 场地修正 + 跨度修正。基准数据来源于国内常规建安工程经验指标。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				floors: {
					type: "number",
					description: "建筑层数"
				},
				seismicIntensity: {
					type: "string",
					description: "设防烈度：6/7/8/9"
				},
				soilCategory: {
					type: "string",
					description: "场地土类别"
				},
				mainSpan: {
					type: "number",
					description: "主要跨度（米）"
				}
			},
			required: [
				"systemId",
				"floors",
				"seismicIntensity"
			]
		},
		allowedAgents: ["economist", "chief"],
		executor: (args) => {
			const systemId = args.systemId;
			const floors = Number(args.floors) || 10;
			const intensity = args.seismicIntensity || "7";
			const soilCategory = args.soilCategory || "Ⅱ";
			const mainSpan = Number(args.mainSpan) || 8;
			const cost = estimateCost(systemId, floors, intensity, soilCategory, mainSpan);
			return {
				systemId,
				systemName: STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId,
				costPerSqm: cost,
				unit: "元/㎡",
				calculationBasis: {
					baseCost: "按结构体系基准造价（10层、7度、Ⅱ类场地基准）",
					adjustments: [
						floors > 10 ? `高度修正 +${((floors - 10) * .5).toFixed(1)}%` : floors < 5 ? "低层优惠 -8%" : "无高度修正",
						`烈度修正：每度约+9%（${intensity}度相对7度）`,
						soilCategory !== "Ⅱ" ? `场地修正：${soilCategory}类` : "场地修正：Ⅱ类（基准）",
						mainSpan > 8 ? `跨度修正：主跨${mainSpan}m，每米+1.5%` : "跨度修正：8m基准"
					]
				}
			};
		}
	},
	{
		name: "estimate_schedule",
		description: "工期估算（月），采用基础+主体+装修三段动态模型。主体工期按结构体系月施工面积效率推算，考虑层数、单层面积、流水施工效率。钢结构/装配式比现浇快 25-35%。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				area: {
					type: "number",
					description: "建筑面积（㎡）"
				},
				floors: {
					type: "number",
					description: "建筑层数"
				}
			},
			required: [
				"systemId",
				"area",
				"floors"
			]
		},
		allowedAgents: ["economist", "chief"],
		executor: (args) => {
			const systemId = args.systemId;
			const months = estimateDuration(systemId, Number(args.area) || 5e3, Number(args.floors) || 10);
			return {
				systemId,
				systemName: STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId,
				totalMonths: months,
				unit: "月",
				breakdown: {
					foundation: "1.5-6个月（按层数递增）",
					superstructure: "按施工面积效率推算",
					fitout: "1-3.5个月（按建筑面积）"
				},
				note: "不含前期报建及室外工程，仅为结构主体+装修估算工期"
			};
		}
	},
	{
		name: "estimate_precast_rate",
		description: "装配率估算，按 GB/T 51129-2017《装配式建筑评价标准》分级：AAA级(≥91%) / AA级(≥76%) / A级(≥60%) / 基本级(≥50%) / 未达标(<50%)。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				floors: {
					type: "number",
					description: "建筑层数，影响装配率修正"
				}
			},
			required: ["systemId"]
		},
		allowedAgents: ["economist"],
		executor: (args) => {
			const systemId = args.systemId;
			const result = estimatePrecastRate(systemId, Number(args.floors) || 10);
			return {
				systemId,
				systemName: STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId,
				precastRate: result.rate,
				grade: result.grade,
				gradeCode: result.gradeCode,
				standard: "GB/T 51129-2017《装配式建筑评价标准》"
			};
		}
	},
	{
		name: "estimate_carbon",
		description: "结构主体隐含碳排放估算（kgCO₂/㎡），基于中国生命周期基础数据库（CLCD）经验值，含建材生产+运输+施工阶段，不含运营阶段。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				floors: {
					type: "number",
					description: "建筑层数"
				}
			},
			required: ["systemId", "floors"]
		},
		allowedAgents: ["economist"],
		executor: (args) => {
			const systemId = args.systemId;
			const carbon = estimateCarbonEmission(systemId, Number(args.floors) || 10);
			return {
				systemId,
				systemName: STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId,
				carbonPerSqm: carbon,
				unit: "kgCO₂/㎡",
				scope: "建材生产 + 运输 + 施工阶段（隐含碳）",
				note: "不含运营阶段碳排放（采暖/空调/照明等）"
			};
		}
	},
	{
		name: "assess_construction_risk",
		description: "施工风险与难度评估：按结构体系给出施工主要风险点清单和风险等级（low/medium/high），含高空作业、起重吊装、焊接作业、大体积混凝土等风险因子。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				floors: {
					type: "number",
					description: "建筑层数"
				}
			},
			required: ["systemId", "floors"]
		},
		allowedAgents: ["economist", "code"],
		executor: (args) => {
			const systemId = args.systemId;
			const risk = estimateConstructionRisk(systemId, Number(args.floors) || 10);
			return {
				systemId,
				systemName: STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId,
				riskLevel: risk.level,
				riskLevelLabel: risk.level === "low" ? "低风险" : risk.level === "medium" ? "中等风险" : "高风险",
				riskFactors: risk.notes,
				mitigation: risk.level === "high" ? "建议制定专项施工方案，加强安全管理，关键工序实行旁站监理" : risk.level === "medium" ? "按常规施工安全管理体系执行，重点关注高处作业和起重吊装" : "常规安全管理即可满足要求"
			};
		}
	},
	{
		name: "advise_foundation",
		description: "基础方案建议：根据上部结构体系、地质条件（含湿陷性黄土等特殊场地）、建筑高度，推荐适用的基础形式及注意事项。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "上部结构体系 ID"
				},
				geologyType: {
					type: "string",
					description: "地质类型：rock（岩石）/ clay（一般黏土）/ loess（湿陷性黄土）/ fill（填土）/ sand（砂土）",
					enum: [
						"rock",
						"clay",
						"loess",
						"fill",
						"sand"
					]
				},
				floors: {
					type: "number",
					description: "建筑层数"
				},
				soilCategory: {
					type: "string",
					description: "场地土类别"
				}
			},
			required: [
				"systemId",
				"geologyType",
				"floors"
			]
		},
		allowedAgents: [
			"architect",
			"code",
			"chief"
		],
		executor: (args) => {
			const systemId = args.systemId;
			const geologyType = args.geologyType;
			const result = suggestFoundation(systemId, geologyType, Number(args.floors) || 10, args.soilCategory || "Ⅱ");
			return {
				systemId,
				systemName: STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId)?.name || systemId,
				geologyType,
				foundationType: result.foundationType,
				reason: result.reason,
				notes: result.notes
			};
		}
	},
	{
		name: "estimate_material_use",
		description: "结构主体材料用量概念估算：混凝土用量（m³/㎡）和用钢量/含钢量（kg/㎡）。按结构体系给出概念区间，并考虑设防烈度修正。标注：概念估算，需专业软件复核。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				floors: {
					type: "number",
					description: "建筑层数"
				},
				seismicIntensity: {
					type: "string",
					description: "设防烈度：6/7/8/9"
				},
				buildingType: {
					type: "string",
					description: "建筑类型"
				}
			},
			required: [
				"systemId",
				"floors",
				"seismicIntensity"
			]
		},
		allowedAgents: [
			"economist",
			"architect",
			"code",
			"chief"
		],
		executor: (args) => {
			const systemId = args.systemId;
			const floors = Number(args.floors) || 10;
			const intensity = Number(args.seismicIntensity) || 7;
			const buildingType = args.buildingType || "residential";
			const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
			const height = calculateBuildingHeight(floors);
			const concreteBase = {
				frame: {
					low: .35,
					high: .5
				},
				"frame-shearwall": {
					low: .45,
					high: .6
				},
				shearwall: {
					low: .5,
					high: .7
				},
				steel: {
					low: .15,
					high: .25
				},
				prefabricated: {
					low: .4,
					high: .55
				},
				"prefab-steel": {
					low: .12,
					high: .22
				},
				composite: {
					low: .3,
					high: .45
				},
				masonry: {
					low: .25,
					high: .35
				},
				"frame-corewall": {
					low: .5,
					high: .65
				},
				"tube-in-tube": {
					low: .55,
					high: .75
				},
				"mass-timber": {
					low: .05,
					high: .12
				},
				"space-truss": {
					low: .1,
					high: .2
				}
			};
			const steelBase = {
				frame: {
					low: 40,
					high: 55
				},
				"frame-shearwall": {
					low: 50,
					high: 65
				},
				shearwall: {
					low: 45,
					high: 60
				},
				steel: {
					low: 60,
					high: 100
				},
				prefabricated: {
					low: 55,
					high: 75
				},
				"prefab-steel": {
					low: 65,
					high: 110
				},
				composite: {
					low: 80,
					high: 120
				},
				masonry: {
					low: 10,
					high: 20
				},
				"frame-corewall": {
					low: 55,
					high: 75
				},
				"tube-in-tube": {
					low: 60,
					high: 85
				},
				"mass-timber": {
					low: 5,
					high: 12
				},
				"space-truss": {
					low: 25,
					high: 45
				}
			};
			const concreteRange = concreteBase[systemId] || concreteBase.frame;
			const steelRange = steelBase[systemId] || steelBase.frame;
			const intensityFactor = 1 + (intensity - 7) * .05;
			const heightFactor = 1 + Math.max(0, (height - 30) / 10) * .03;
			const concreteLow = (concreteRange.low * intensityFactor * heightFactor).toFixed(2);
			const concreteHigh = (concreteRange.high * intensityFactor * heightFactor).toFixed(2);
			const steelLow = Math.round(steelRange.low * intensityFactor * heightFactor);
			const steelHigh = Math.round(steelRange.high * intensityFactor * heightFactor);
			return {
				systemId,
				systemName: scheme?.name || systemId,
				buildingType,
				concretePerSqm: {
					low: Number(concreteLow),
					high: Number(concreteHigh),
					unit: "m³/㎡",
					note: "含楼板、梁、柱、墙等主体结构混凝土，不含基础、二次结构"
				},
				steelPerSqm: {
					low: steelLow,
					high: steelHigh,
					unit: "kg/㎡",
					note: [
						"steel",
						"prefab-steel",
						"space-truss"
					].includes(systemId) ? "型钢用量，不含楼板钢筋" : "含普通钢筋（受力筋+箍筋+分布筋），不含预应力筋"
				},
				calculationBasis: {
					base: `${scheme?.name || systemId}体系基准区间（10层、7度、住宅类）`,
					adjustments: [`烈度修正：${intensity}度，系数 ${intensityFactor.toFixed(2)}（每度±5%）`, `高度修正：约 ${height}m，系数 ${heightFactor.toFixed(2)}（每10m +3%）`]
				},
				disclaimer: "方案阶段量级估算，仅供概念比选用；实际含钢量受柱网布置、抗震等级、荷载标准等因素影响，±15%均属正常范围，需专业结构计算软件复核。"
			};
		}
	},
	{
		name: "estimate_column_beam",
		description: "典型构件截面概念估算：柱截面尺寸（mm）和主梁梁高（mm）。梁高按跨度 1/12~1/18 估算；柱截面按层数、轴压比、设防烈度给概念区间。标注：概念估算，需专业软件复核。",
		parameters: {
			type: "object",
			properties: {
				systemId: {
					type: "string",
					description: "结构体系 ID"
				},
				span: {
					type: "number",
					description: "主要跨度（米）"
				},
				floors: {
					type: "number",
					description: "建筑层数"
				},
				seismicIntensity: {
					type: "string",
					description: "设防烈度：6/7/8/9"
				},
				soilCategory: {
					type: "string",
					description: "场地土类别"
				}
			},
			required: [
				"systemId",
				"span",
				"floors",
				"seismicIntensity"
			]
		},
		allowedAgents: [
			"architect",
			"code",
			"chief"
		],
		executor: (args) => {
			const systemId = args.systemId;
			const span = Number(args.span) || 8;
			const floors = Number(args.floors) || 10;
			const intensity = Number(args.seismicIntensity) || 7;
			const scheme = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === systemId);
			let beamRatioLow = 1 / 12;
			let beamRatioHigh = 1 / 18;
			let beamUnit = "mm";
			if (systemId === "frame") {
				beamRatioLow = 1 / 10;
				beamRatioHigh = 1 / 14;
			} else if (systemId === "shearwall" || systemId === "tube-in-tube") {
				beamRatioLow = 1 / 8;
				beamRatioHigh = 1 / 12;
			} else if (systemId === "steel" || systemId === "prefab-steel" || systemId === "space-truss") {
				beamRatioLow = 1 / 18;
				beamRatioHigh = 1 / 24;
			} else if (systemId === "composite") {
				beamRatioLow = 1 / 15;
				beamRatioHigh = 1 / 20;
			} else if (systemId === "masonry") {
				beamRatioLow = 1 / 12;
				beamRatioHigh = 1 / 16;
			}
			const beamLow = Math.round(span * 1e3 * beamRatioHigh);
			const beamHigh = Math.round(span * 1e3 * beamRatioLow);
			let colSizeBase = 0;
			let colSizeUnit = "mm";
			if (systemId.includes("steel") || systemId === "space-truss") {
				colSizeBase = 200 + floors * 15;
				const colLow = Math.max(200, Math.round(colSizeBase * .8));
				const colHigh = Math.round(colSizeBase * 1.15);
				return {
					systemId,
					systemName: scheme?.name || systemId,
					span,
					floors,
					beam: {
						range: `${beamLow}~${beamHigh}`,
						unit: beamUnit,
						description: `主梁梁高（钢梁高跨比约 1/18~1/24），梁宽约为高度的 1/2~1/3`
					},
					column: {
						range: `H${colLow}×${colLow}~H${colHigh}×${colHigh}`,
						unit: colSizeUnit,
						description: "钢柱截面估算（箱形或H形），具体尺寸需根据轴压比和长细比计算"
					},
					disclaimer: "方案阶段量级估算，仅供空间占位和造价估算参考。需专业结构计算软件（PKPM/YJK/SAUSAGE 等）按实际荷载和抗震等级分析确定。"
				};
			}
			const intensityFactor = 1 + (intensity - 7) * .1;
			let colEdge = 300 + floors * 15;
			colEdge = Math.round(colEdge * intensityFactor);
			if (systemId === "shearwall" || systemId === "tube-in-tube") colEdge = Math.round(colEdge * 1.1);
			if (systemId === "masonry") {
				const wallThickness = floors <= 6 ? 240 : 370;
				return {
					systemId,
					systemName: scheme?.name || systemId,
					span,
					floors,
					beam: {
						range: `${beamLow}~${beamHigh}`,
						unit: beamUnit,
						description: "圈梁/过梁高度"
					},
					column: {
						range: `墙厚 ${wallThickness}mm，构造柱 240×240`,
						unit: colSizeUnit,
						description: "砌体结构以承重墙为主，构造柱仅做抗震措施，截面较小"
					},
					disclaimer: "方案阶段量级估算。砌体结构需符合 GB 55007-2021《砌体结构通用规范》。"
				};
			}
			const colLow = Math.round(colEdge * .85);
			const colHigh = Math.round(colEdge * 1.15);
			return {
				systemId,
				systemName: scheme?.name || systemId,
				span,
				floors,
				beam: {
					range: `${beamLow}~${beamHigh}`,
					unit: beamUnit,
					description: `主梁梁高（高跨比约 ${(1 / beamRatioLow).toFixed(0)}~${(1 / beamRatioHigh).toFixed(0)}分之一），梁宽约为高度的 1/2~2/3`
				},
				column: {
					range: `${colLow}×${colLow}~${colHigh}×${colHigh}`,
					unit: colSizeUnit,
					description: `框架柱/端柱截面估算（正方形），截面按 ${intensity}度设防、约 ${floors} 层估算，底部加强区偏大、上部楼层可递减`
				},
				calculationBasis: {
					formula: "柱边长 ≈ (300 + 层数×15) × 烈度修正系数",
					beamFormula: `梁高 ≈ 跨度 × 高跨比 (${(1 / beamRatioHigh).toFixed(0)}~${(1 / beamRatioLow).toFixed(0)}分之一)`,
					notes: ["柱截面按底部加强部位估算，以上各层可逐级收窄", "轴压比控制是柱截面主要控制因素，抗震等级每提高一级截面约增大 10%"]
				},
				disclaimer: "方案阶段量级估算，仅供空间占位和造价估算参考。实际截面需根据轴压比、剪压比、延性要求等按规范计算确定。"
			};
		}
	},
	{
		name: "compare_schemes",
		description: "四维权重（性能/经济/绿色低碳/安全）综合对比评分，对多个候选方案进行加权计算并排序，返回排序结果、分项得分、推荐方案。",
		parameters: {
			type: "object",
			properties: {
				schemeIds: {
					type: "array",
					description: "待对比的结构体系 ID 列表",
					items: { type: "string" }
				},
				params: {
					type: "object",
					description: "工程参数（用于估算各方案指标）",
					properties: {
						buildingType: {
							type: "string",
							description: "建筑类型"
						},
						floors: {
							type: "number",
							description: "层数"
						},
						area: {
							type: "number",
							description: "面积"
						},
						seismicIntensity: {
							type: "string",
							description: "设防烈度"
						},
						soilCategory: {
							type: "string",
							description: "场地土类别"
						},
						mainSpan: {
							type: "number",
							description: "主跨"
						}
					},
					required: [
						"buildingType",
						"floors",
						"seismicIntensity"
					]
				},
				weights: {
					type: "object",
					description: "四维权重配置（四项之和应为100）",
					properties: {
						cost: {
							type: "number",
							description: "造价经济权重（%）"
						},
						duration: {
							type: "number",
							description: "工期权重（%）"
						},
						safety: {
							type: "number",
							description: "安全抗震权重（%）"
						},
						green: {
							type: "number",
							description: "绿色低碳权重（%）"
						}
					},
					required: [
						"cost",
						"duration",
						"safety",
						"green"
					]
				}
			},
			required: [
				"schemeIds",
				"params",
				"weights"
			]
		},
		allowedAgents: ["chief"],
		executor: (args) => {
			const schemeIds = args.schemeIds;
			const p = args.params;
			const w = args.weights;
			const params = {
				buildingType: p.buildingType || "residential",
				floors: Number(p.floors) || 10,
				area: Number(p.area) || 5e3,
				structurePreference: "any",
				seismicIntensity: p.seismicIntensity || "7",
				soilCategory: p.soilCategory || "Ⅱ",
				geologyType: "clay",
				mainSpan: Number(p.mainSpan) || 8,
				budget: 4e3,
				windPressure: p.windPressure || "0.4",
				snowPressure: p.snowPressure || "0.2",
				fortificationCategory: p.fortificationCategory || "standard"
			};
			const allSchemes = generateSchemesFromParams(params);
			const filtered = allSchemes.filter((s) => schemeIds.includes(s.id));
			const schemes = filtered.length > 0 ? filtered : allSchemes;
			const weightTotal = (w.cost || 0) + (w.duration || 0) + (w.safety || 0) + (w.green || 0) || 100;
			const results = schemes.map((s) => {
				const b = computeSchemeScore(s, {
					cost: w.cost || 0,
					duration: w.duration || 0,
					safety: w.safety || 0,
					green: w.green || 0
				});
				return {
					schemeId: s.id,
					schemeName: s.name,
					score: b.overall,
					breakdown: {
						造价经济: b.cost,
						工期优势: b.duration,
						安全抗震: b.safety,
						绿色低碳: b.green,
						抗震性能: b.seismic,
						施工难度: b.difficulty,
						可持续性: b.sustain,
						碳排放: b.carbon,
						装配率: b.precast,
						综合性能: b.performance
					},
					metrics: {
						cost: s.metrics.cost,
						duration: s.metrics.duration,
						seismicPerformance: s.metrics.seismicPerformance,
						constructionDifficulty: s.metrics.constructionDifficulty,
						sustainability: s.metrics.sustainability,
						carbonEmission: s.metrics.carbonEmission,
						precastRate: s.metrics.precastRate.rate
					}
				};
			});
			results.sort((a, b) => b.score - a.score);
			const height = params.floors * 3;
			const parsedIntensity = parseInt(params.seismicIntensity, 10);
			if (params.buildingType === "residential" && parsedIntensity >= 8 && height >= 30) {
				const seismicWallIds = [
					"shearwall",
					"frame-shearwall",
					"frame-corewall",
					"tube-in-tube"
				];
				results.forEach((r) => {
					if (seismicWallIds.includes(r.schemeId)) r.score = Math.round((r.score + 1.2) * 10) / 10;
				});
				results.sort((a, b) => b.score - a.score);
			}
			return {
				ranking: results,
				weights: w,
				weightTotal,
				recommended: {
					schemeId: results[0]?.schemeId || "",
					schemeName: results[0]?.schemeName || "",
					overallScore: results[0]?.score || 0
				}
			};
		}
	}
];
/** 按工具名执行，结果为 Promise（兼容异步） */
function executeToolByName(name, args) {
	const tool = TOOL_REGISTRY.find((t) => t.name === name);
	if (!tool) throw new Error(`Unknown tool: ${name}`);
	return tool.executor(args);
}
//#endregion
//#region src/agent/trace-engine.ts
var THINK_TEMPLATES = [
	{
		id: "arch-height-screening",
		agent: "architect",
		priority: 100,
		condition: () => true,
		generate: (p) => {
			const height = p.buildingHeight ?? p.floors * 3;
			const intensity = parseInt(p.seismicIntensity, 10);
			const limits = {
				"砌体结构": {
					6: 21,
					7: 21,
					8: 18,
					9: 12
				},
				"框架结构": {
					6: 60,
					7: 50,
					8: 40,
					9: 24
				},
				"框架-剪力墙": {
					6: 130,
					7: 120,
					8: 100,
					9: 50
				},
				"剪力墙结构": {
					6: 140,
					7: 120,
					8: 100,
					9: 60
				},
				"框架核心筒": {
					6: 160,
					7: 150,
					8: 130,
					9: 70
				},
				"筒中筒": {
					6: 220,
					7: 200,
					8: 180,
					9: 100
				}
			};
			const passed = [];
			const failed = [];
			Object.entries(limits).forEach(([name, lim]) => {
				const maxH = lim[intensity] || 50;
				if (height <= maxH) passed.push(name);
				else failed.push(`${name}(限${maxH}m)`);
			});
			return `【第一步：高度限值初筛】
建筑高度约 ${height}m（${p.floors}层${p.buildingHeight ? "" : " × 3m/层估算"}），${p.seismicIntensity}度设防。
我先按 GB/T 50011 表 6.1.1 的最大适用高度限值过一遍，把超限的体系直接排除：

✅ 通过高度限值（${passed.length}个）：${passed.join("、")}
❌ 高度超限排除（${failed.length}个）：${failed.join("、")}

通过高度初筛后，再结合建筑功能、场地条件、预算约束进一步缩小范围。`;
		}
	},
	{
		id: "arch-drift-estimate",
		agent: "architect",
		priority: 95,
		condition: (p) => parseInt(p.seismicIntensity, 10) >= 7 && p.floors > 6,
		generate: (p) => {
			const height = p.buildingHeight ?? p.floors * 3;
			const intensity = parseInt(p.seismicIntensity, 10);
			const driftApprox = {
				"框架": `约 1/${Math.round(height * 1e3 / (height * 2 + intensity * 5))}（接近1/500~1/700范围）`,
				"框剪": `约 1/${Math.round(height * 1e3 / (height * .8 + intensity * 2))}（约1/1000量级）`,
				"剪力墙": `约 1/${Math.round(height * 1e3 / (height * .5 + intensity * 1))}（约1/1500量级）`
			};
			const frameLimit = 1 / 550;
			const frameDriftEst = height / (height * .7 + intensity * 8);
			return `【第二步：位移角预判】
${p.seismicIntensity}度设防、高约 ${height}m，我先凭经验估一下各体系的层间位移角量级，看看哪些体系刚度可能不够：

  • 框架体系：位移角 ${driftApprox["框架"]}，限值 1/550 —— ${frameDriftEst > frameLimit ? "⚠️ 大概率超限，刚度不够" : "基本满足"}
  • 框剪体系：位移角 ${driftApprox["框剪"]}，限值 1/800 —— 通常能满足，有一定余量
  • 剪力墙体系：位移角 ${driftApprox["剪力墙"]}，限值 1/1000 —— 刚度富裕度大

初步判断：${intensity >= 8 && height > 30 ? "高烈度中高层，纯框架体系位移角大概率过不了，排除。重点比较框剪和剪力墙。" : "烈度不高或高度不大，框架和框剪都有机会，看具体计算。"}`;
		}
	},
	{
		id: "arch-budget-screening",
		agent: "architect",
		priority: 85,
		condition: (p) => p.budget > 0,
		generate: (p) => {
			const budget = p.budget;
			const costLevels = [
				{
					name: "砌体结构",
					cost: 2e3,
					pass: budget >= 2e3
				},
				{
					name: "框架结构",
					cost: 3e3,
					pass: budget >= 3e3
				},
				{
					name: "框架-剪力墙",
					cost: 3800,
					pass: budget >= 3800
				},
				{
					name: "剪力墙结构",
					cost: 4200,
					pass: budget >= 4200
				},
				{
					name: "钢结构",
					cost: 5500,
					pass: budget >= 5500
				},
				{
					name: "框架核心筒",
					cost: 5800,
					pass: budget >= 5800
				},
				{
					name: "筒中筒",
					cost: 7e3,
					pass: budget >= 7e3
				}
			];
			const ok = costLevels.filter((c) => c.pass).map((c) => c.name);
			const tight = costLevels.filter((c) => !c.pass).map((c) => c.name);
			return `【第三步：预算约束筛选】
项目预算 ${budget} 元/㎡，按各体系常规造价水平筛一遍：

  ✅ 预算内（${ok.length}个）：${ok.join("、")}
  ⚠️ 预算偏紧/超（${tight.length}个）：${tight.join("、")}

${budget < 3500 ? "预算偏紧，优先考虑现浇混凝土体系，钢结构、组合结构等高造价方案暂不推荐。" : budget < 5e3 ? "预算中等，现浇混凝土体系都能覆盖，钢结构需控制用钢量。" : "预算较充裕，可以考虑钢结构、组合结构等高性能方案。"}`;
		}
	},
	{
		id: "arch-precast-demand",
		agent: "architect",
		priority: 80,
		condition: (p) => p.structurePreference === "prefabricated" || p.structurePreference === "steel",
		generate: (p) => `【装配式诉求分析】项目明确倾向 ${p.structurePreference === "prefabricated" ? "装配式混凝土" : "钢结构"} 体系，符合建筑工业化发展方向。\n装配式体系在工期、环保、质量可控性方面有明显优势，但需关注造价增量和节点抗震性能。我将重点评估装配式方案的性价比。`
	},
	{
		id: "arch-loess-site",
		agent: "architect",
		priority: 75,
		condition: (p) => p.geologyType === "loess",
		generate: (p) => `【场地条件分析】本项目场地为湿陷性黄土，这是基础设计的关键控制因素。\n湿陷性黄土地区需特别关注：地基处理方案选择、基础埋深要求、场地排水设计。上部结构宜优先选择自重较轻的体系（钢结构、装配式），或采用桩基础穿透湿陷性土层。`
	},
	{
		id: "arch-large-span",
		agent: "architect",
		priority: 70,
		condition: (p) => p.mainSpan >= 18,
		generate: (p) => `【跨度分析】主跨 ${p.mainSpan}m 属于大跨度范畴，普通混凝土框架梁可能不经济。\n大跨度项目应优先考虑钢结构、空间桁架/网架、组合结构等跨越能力强的体系。${p.mainSpan >= 30 ? "30m以上大跨强烈建议采用空间结构体系。" : "18-30m跨度钢结构和组合结构均有较好适用性。"}`
	},
	{
		id: "arch-low-rise-masonry",
		agent: "architect",
		priority: 65,
		condition: (p) => p.floors <= 6 && p.seismicIntensity <= "7",
		generate: (p) => `【多层低烈度分析】${p.floors}层 + ${p.seismicIntensity}度设防属于多层低烈度范畴，砌体结构和框架结构均有良好适用性。\n多层砌体结构在经济性上具有明显优势，但需注意抗震构造措施的落实。框架结构则空间灵活性更好。`
	},
	{
		id: "arch-9-degree-caution",
		agent: "architect",
		priority: 95,
		condition: (p) => p.seismicIntensity === "9",
		generate: (p) => `【高烈度区审慎提示】9度设防属于高烈度区，结构选型需极其谨慎。\n9度区：砌体结构基本不适用；框架结构适用高度极低（仅24m）；应优先选用剪力墙、框剪、框筒等高刚度体系。同时需关注隔震减震技术的应用可能性。本方案仅供概念比选，实际工程必须进行专项抗震性能化设计。`
	},
	{
		id: "arch-intro",
		agent: "architect",
		priority: 10,
		condition: () => true,
		generate: (p) => `我来分析一下这个项目的结构方案选型问题。\n项目概况：${p.floors}层 ${p.buildingType === "residential" ? "住宅" : p.buildingType === "office" ? "办公楼" : p.buildingType === "school" ? "教学楼" : p.buildingType === "factory" ? "厂房" : "体育馆"}，建筑面积约 ${p.area.toLocaleString()}㎡，${p.seismicIntensity}度设防，${p.soilCategory}类场地，主跨 ${p.mainSpan}m，预算 ${p.budget} 元/㎡。\n\n首先，我将调用 query_structure_systems 工具，从12类结构体系库中按8维度筛选出最适合的候选方案。`
	},
	{
		id: "code-plan-checklist",
		agent: "code",
		priority: 50,
		condition: () => true,
		generate: (p) => {
			const intensity = parseInt(p.seismicIntensity, 10);
			p.buildingHeight ?? p.floors * 3;
			return `【校核清单】对每个候选方案，我将逐项校核以下关键指标：

  1️⃣ 高度适用范围 —— 对照 GB/T 50011 表 6.1.1，${p.seismicIntensity}度区
  2️⃣ 弹性层间位移角 —— 框架 1/550、框剪 1/800、剪力墙 1/1000（GB 55002 表 5.1.2）
  3️⃣ 剪重比（最小地震剪力系数） —— ${intensity}度区 ${intensity >= 8 ? .032 : .024}（多遇地震）
  4️⃣ 轴压比限值 —— 框架柱、剪力墙底部加强部位分别核算
  5️⃣ 周期比（Tt/T1） —— 扭转周期与平动周期比 ≤ 0.9
  6️⃣ 防火耐火等级 —— 构件耐火极限，对照 GB 55037
  7️⃣ 抗震等级 —— 按高度+烈度确定一~四级

所有校核项都按规范硬编码限值，我不做自由发挥。发现超限就直接报 fail。`;
		}
	},
	{
		id: "code-highlight-drift",
		agent: "code",
		priority: 60,
		condition: (p) => parseInt(p.seismicIntensity, 10) >= 8,
		generate: (p) => {
			const height = p.buildingHeight ?? p.floors * 3;
			return `【重点关注】${p.seismicIntensity}度高烈度设防，位移角是最容易翻车的项。

先复习一下限值（GB 55002-2021 表 5.1.2 弹性层间位移角限值）：
  • 框架结构：1/550
  • 框架-抗震墙结构：1/800
  • 抗震墙结构：1/1000
  • 框架-核心筒：1/800

按经验估算，${height}m 高的建筑，层间位移角大致和结构侧向刚度成反比。
高烈度区纯框架几乎肯定位移角过不了，等下算出来看具体数值。`;
		}
	},
	{
		id: "code-intro",
		agent: "code",
		priority: 10,
		condition: () => true,
		generate: () => `接下来由我（规范校核工程师）对各候选方案进行逐条规范校核。
校核内容涵盖：抗震规范（GB 55002-2021 / GB/T 50011）和防火规范（GB 55037-2022）两大类。每项校核均给出：规范依据条文号、计算过程、限值对比、判定结论（符合/需注意/不符合）。`
	},
	{
		id: "econ-intro",
		agent: "economist",
		priority: 10,
		condition: () => true,
		generate: () => `我来对各方案进行经济与绿色指标评估。\n评估维度包括：单位面积造价、总工期、装配率及分级、隐含碳排放、施工风险等级。所有指标均基于工程经验数据库进行估算。`
	},
	{
		id: "econ-cost-focus",
		agent: "economist",
		priority: 20,
		condition: (p) => p.budget < 3500,
		generate: (p) => `【造价敏感提示】${p.budget} 元/㎡的预算较为紧张，造价将是重要决策因素。\n经济性排序（从低到高）大致为：砌体 < 框架 < 框剪 < 装配式 < 剪力墙 < 组合结构 < 钢结构。但具体仍需结合高度、烈度等修正因素计算。`
	},
	{
		id: "econ-green-focus",
		agent: "economist",
		priority: 25,
		condition: (p) => p.buildingType === "school" || p.buildingType === "gymnasium",
		generate: () => `【绿色低碳分析】公共建筑项目通常对绿色建筑和双碳目标有较高要求。\n碳排放量排序（从低到高）大致为：胶合木 < 装配式钢结构 < 钢结构 < 空间桁架 < 装配式混凝土 < 框架 < 框剪 < 剪力墙。装配率方面，钢结构和装配式体系可达 AA 级以上。`
	},
	{
		id: "chief-intro-numeric",
		agent: "chief",
		priority: 20,
		condition: () => true,
		generate: (p) => {
			const height = p.buildingHeight ?? p.floors * 3;
			return `【总工进场】前三轮分析都做完了，我来做最终裁决。

先整理一下已知条件：
  • 建筑类型：${p.buildingType === "residential" ? "住宅" : p.buildingType === "office" ? "办公楼" : p.buildingType === "school" ? "教学楼" : p.buildingType === "factory" ? "厂房" : "体育馆"}
  • 高度：约 ${height}m（${p.floors}层）
  • 设防烈度：${p.seismicIntensity}度
  • 场地类别：${p.soilCategory}类
  • 预算：${p.budget} 元/㎡

我的评审思路：先看 Code Agent 的规范校核结果——凡是有 fail 的方案直接排除；再在 pass 的方案里按加权评分排座次；最后对第一名做一次反向质疑，看看有没有什么隐患被加权评分掩盖了。`;
		}
	},
	{
		id: "chief-high-seismic-residential",
		agent: "chief",
		priority: 50,
		condition: (p) => {
			const h = p.floors * 3;
			const intensity = parseInt(p.seismicIntensity, 10);
			return p.buildingType === "residential" && intensity >= 8 && h >= 30;
		},
		generate: (p) => {
			const h = p.floors * 3;
			return `【总工评审要点】本项目为 ${p.seismicIntensity} 度设防、约 ${h}m 高的住宅建筑，属于高烈度区中高层住宅。\n按工程常识，此类项目应以侧向刚度控制为核心设计原则——水平地震作用下的层间位移角、结构延性和耗能能力是选型的决定因素。\n框架结构虽然造价低，但在 8 度区 30m+ 高度下抗侧刚度不足，节点剪力大，延性耗能有限，通常不是最优解。\n框架-剪力墙体系兼具框架的空间灵活性和剪力墙的抗侧刚度，刚度与经济性的平衡点较好，是住宅类项目的常用优选。\n剪力墙体系抗侧刚度最大、抗震性能最优，但建筑布置灵活性受限、自重较大。\n我将在综合评分中充分考虑"高烈度+高层+住宅"这一组合对结构体系侧向刚度的刚性要求，避免单纯以造价最低为导向的误判。`;
		}
	}
];
var TraceEngine = class {
	stepCounter = 0;
	actionLog = [];
	params;
	weights;
	currentAgent = null;
	constructor(params, weights) {
		this.params = params;
		this.weights = weights;
	}
	/** 追加一条行动日志 */
	pushLog(entry) {
		this.stepCounter += 1;
		this.actionLog.push({
			...entry,
			step: this.stepCounter,
			timestamp: Date.now()
		});
	}
	/** 为指定子 Agent 生成思考步骤（按触发条件筛选 + 优先级排序） */
	generateThoughtsForAgent(agentId, context) {
		return THINK_TEMPLATES.filter((t) => t.agent === agentId && t.condition(this.params, context)).sort((a, b) => b.priority - a.priority).map((t) => t.generate(this.params, context));
	}
	/** 获取某个体系在当前建筑类型下的适配等级（>=0 表示适用） */
	getBuildingTypeRank(systemId) {
		return ({
			residential: [
				"shearwall",
				"frame-shearwall",
				"prefabricated",
				"frame",
				"masonry",
				"frame-corewall",
				"tube-in-tube"
			],
			office: [
				"frame-shearwall",
				"frame-corewall",
				"tube-in-tube",
				"composite",
				"steel",
				"prefab-steel",
				"frame"
			],
			school: [
				"frame",
				"masonry",
				"prefabricated",
				"frame-shearwall",
				"mass-timber",
				"steel"
			],
			factory: [
				"steel",
				"prefab-steel",
				"space-truss",
				"frame",
				"composite"
			],
			gymnasium: [
				"space-truss",
				"steel",
				"prefab-steel",
				"composite",
				"mass-timber"
			]
		}[this.params.buildingType] || []).indexOf(systemId);
	}
	/** 运行 Architect Agent：筛选候选体系 + 思考评述 */
	runArchitect() {
		this.currentAgent = "architect";
		const logs = [];
		const push = (entry) => {
			this.pushLog({
				...entry,
				agent: "architect"
			});
			logs.push({
				...entry,
				step: this.stepCounter,
				agent: "architect",
				timestamp: Date.now()
			});
		};
		this.generateThoughtsForAgent("architect").forEach((text) => {
			push({
				type: "think",
				content: text
			});
		});
		push({
			type: "tool_call",
			content: "调用 query_structure_systems 筛选候选结构体系",
			tool: "query_structure_systems",
			args: {
				filters: {
					buildingType: this.params.buildingType,
					floors: this.params.floors,
					area: this.params.area,
					seismicIntensity: this.params.seismicIntensity,
					soilCategory: this.params.soilCategory,
					mainSpan: this.params.mainSpan,
					budget: this.params.budget,
					structurePreference: this.params.structurePreference
				},
				topN: 3
			}
		});
		const toolResult = executeToolByName("query_structure_systems", {
			filters: {
				buildingType: this.params.buildingType,
				floors: this.params.floors,
				area: this.params.area,
				seismicIntensity: this.params.seismicIntensity,
				soilCategory: this.params.soilCategory,
				mainSpan: this.params.mainSpan,
				budget: this.params.budget,
				structurePreference: this.params.structurePreference
			},
			topN: 3
		});
		push({
			type: "tool_result",
			content: `筛选完成：从 12 类结构体系库中选出 ${toolResult.total} 个候选方案，得分最高的前 3 个为：${toolResult.candidates.map((c) => c.name).join("、")}`,
			tool: "query_structure_systems",
			result: toolResult
		});
		push({
			type: "conclusion",
			content: `候选方案筛选完成。\n综合考虑高度适配、建筑类型匹配、跨度要求、预算约束、抗震需求等8个维度，最终确定以下 3 个候选方案进入下一轮详细评估：\n${toolResult.candidates.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}\n\n下一步交由规范校核工程师进行逐条规范符合性验证。`
		});
		return {
			candidates: toolResult.candidates.map((c) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === c.id)).filter((s) => !!s),
			logs
		};
	}
	/** 运行 Code Agent：规范校核 */
	runCode(schemeIds) {
		this.currentAgent = "code";
		const logs = [];
		const push = (entry) => {
			this.pushLog({
				...entry,
				agent: "code"
			});
			logs.push({
				...entry,
				step: this.stepCounter,
				agent: "code",
				timestamp: Date.now()
			});
		};
		this.generateThoughtsForAgent("code").forEach((text) => {
			push({
				type: "think",
				content: text
			});
		});
		const codeChecks = {};
		schemeIds.forEach((schemeId) => {
			const schemeName = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId)?.name || schemeId;
			push({
				type: "tool_call",
				content: `对「${schemeName}」进行抗震规范校核`,
				tool: "check_seismic_requirements",
				args: {
					systemId: schemeId,
					params: {
						floors: this.params.floors,
						seismicIntensity: this.params.seismicIntensity,
						soilCategory: this.params.soilCategory,
						buildingType: this.params.buildingType
					}
				}
			});
			const seisResult = executeToolByName("check_seismic_requirements", {
				systemId: schemeId,
				params: {
					floors: this.params.floors,
					seismicIntensity: this.params.seismicIntensity,
					soilCategory: this.params.soilCategory,
					buildingType: this.params.buildingType
				}
			});
			push({
				type: "tool_result",
				content: `「${schemeName}」抗震校核完成：${seisResult.passCount} 项符合 / ${seisResult.warningCount} 项需注意 / ${seisResult.failCount} 项不符合`,
				tool: "check_seismic_requirements",
				result: seisResult
			});
			push({
				type: "tool_call",
				content: `对「${schemeName}」进行防火规范校核`,
				tool: "check_fire_requirements",
				args: {
					systemId: schemeId,
					floors: this.params.floors,
					buildingType: this.params.buildingType
				}
			});
			const fireResult = executeToolByName("check_fire_requirements", {
				systemId: schemeId,
				floors: this.params.floors,
				buildingType: this.params.buildingType
			});
			push({
				type: "tool_result",
				content: `「${schemeName}」防火校核完成：耐火等级 ${fireResult.fireResistanceGrade}`,
				tool: "check_fire_requirements",
				result: fireResult
			});
			codeChecks[schemeId] = {
				seismic: seisResult,
				fire: fireResult
			};
		});
		push({
			type: "conclusion",
			content: `规范校核完成。\n对 ${schemeIds.length} 个候选方案逐一进行了抗震规范（GB 55002-2021 / GB/T 50011）和防火规范（GB 55037-2022）的逐条校核。\n各方案详细校核结果已记录在案，供总工综合评审参考。\n下一步交由经济评估工程师进行造价、工期、绿色指标评估。`
		});
		return {
			codeChecks,
			logs
		};
	}
	/**
	* Multi-Agent 辩论环节：Code Agent 挑刺 → Architect 回应换方案 → Code 再校核
	* 替代原有的单 Agent 自主调整回环，体现 Agent 之间有来有回的辩论过程
	*/
	runDebateLoop(initialSchemeIds, initialCodeChecks) {
		const logs = [];
		const pushCode = (entry) => {
			this.pushLog({
				...entry,
				agent: "code"
			});
			logs.push({
				...entry,
				step: this.stepCounter,
				agent: "code",
				timestamp: Date.now()
			});
		};
		const pushArch = (entry) => {
			this.currentAgent = "architect";
			this.pushLog({
				...entry,
				agent: "architect"
			});
			logs.push({
				...entry,
				step: this.stepCounter,
				agent: "architect",
				timestamp: Date.now()
			});
			this.currentAgent = "code";
		};
		this.currentAgent = "code";
		let schemeIds = [...initialSchemeIds];
		let codeChecks = { ...initialCodeChecks };
		const replacements = [];
		const MAX_ROUNDS = 2;
		const stiffnessLadder = [
			"masonry",
			"frame",
			"composite",
			"frame-shearwall",
			"shearwall",
			"frame-corewall",
			"tube-in-tube"
		];
		const getSeismicChecks = (sid) => {
			return codeChecks[sid]?.seismic?.checks ?? [];
		};
		const findFailingSchemes = (ids) => {
			return ids.map((sid) => {
				return {
					schemeId: sid,
					failItems: getSeismicChecks(sid).filter((c) => c.status === "fail").map((c) => c.name)
				};
			}).filter((x) => x.failItems.length > 0);
		};
		const architectSuggestReplacement = (failedId, failItems) => {
			if (!STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === failedId)) return null;
			const hasDriftFail = failItems.some((n) => n.includes("位移角"));
			const hasHeightFail = failItems.some((n) => n.includes("高度") || n.includes("适用高度"));
			const alreadyUsed = new Set(schemeIds);
			if (hasDriftFail) {
				const currentIdx = stiffnessLadder.indexOf(failedId);
				if (currentIdx >= 0) for (let i = currentIdx + 1; i < stiffnessLadder.length; i++) {
					const candidate = stiffnessLadder[i];
					if (!alreadyUsed.has(candidate)) {
						if (this.getBuildingTypeRank(candidate) >= 0) return candidate;
					}
				}
			}
			if (hasHeightFail) {
				for (const sid of [
					"steel",
					"prefab-steel",
					"composite"
				]) if (!alreadyUsed.has(sid)) {
					if (this.getBuildingTypeRank(sid) >= 0) return sid;
				}
			}
			if (this.params.buildingType === "residential" && !alreadyUsed.has("shearwall")) return "shearwall";
			if (this.params.buildingType === "office" && !alreadyUsed.has("frame-corewall")) return "frame-corewall";
			return null;
		};
		let loops = 0;
		let failing = findFailingSchemes(schemeIds);
		if (failing.length === 0) {
			this.currentAgent = "architect";
			return {
				finalSchemeIds: schemeIds,
				finalCodeChecks: codeChecks,
				loops: 0,
				replacements: [],
				allPass: true,
				logs: []
			};
		}
		pushCode({
			type: "think",
			content: `【规范校核发现问题 · 向 Architect 提出质疑】
我逐条校核了 ${schemeIds.length} 个候选方案的抗震规范（GB 55002-2021）和防火规范（GB 55037-2022），发现 ${failing.length} 个方案存在不符合项：
${failing.map((f) => {
				return `• ${STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === f.schemeId)?.name}：${f.failItems.join("、")}`;
			}).join("\n")}

作为 Code Agent，我不能让这些不合规的方案进入下一阶段。请 Architect 重新考虑方案选型。`
		});
		for (let loop = 1; loop <= MAX_ROUNDS; loop++) {
			loops = loop;
			const loopReplacements = [];
			for (const failItem of failing) {
				const originalName = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === failItem.schemeId)?.name || failItem.schemeId;
				const failDetail = getSeismicChecks(failItem.schemeId).filter((c) => c.status === "fail");
				failDetail.map((c) => `${c.name}（实际${c.value || "?"}，限值${c.limit || "?"}）`).join("、");
				const failItemsWithDetail = failDetail.map((c) => {
					const actual = c.value || "未通过";
					const limit = c.limit || "限值";
					let severity = "";
					if (c.name.includes("位移角") && c.value && c.limit) {
						const actualNum = parseFloat(String(c.value).replace("1/", ""));
						const limitNum = parseFloat(String(c.limit).replace("1/", ""));
						if (actualNum && limitNum) severity = `（超出${(limitNum / actualNum).toFixed(1)}倍）`;
					}
					return `${c.name}：实际 ${actual}，限值 ${limit}${severity}`;
				}).join("\n  ");
				pushCode({
					type: "think",
					content: `【第${loop}轮辩论 · Code 挑刺 ${originalName}】
逐一审校后，发现以下不符合项：

  ${failItemsWithDetail}

判定结论：${originalName} 不满足规范要求，不能作为推荐方案进入下一轮。
请 Architect 重新选型，我再核。`
				});
				const replacementId = architectSuggestReplacement(failItem.schemeId, failItem.failItems);
				if (!replacementId) {
					pushArch({
						type: "think",
						content: `【第${loop}轮辩论 · Architect 回应 ${originalName}】
收到 Code Agent 的质疑。我重新梳理了 12 类结构体系库，遗憾的是——在当前项目参数（${this.params.seismicIntensity}度区、约${this.params.floors * 3}m高）下，已找不到更合适的常规体系。

处理方案：保留 ${originalName} 作为参考方案，但在最终推荐中明确标注——超出规范常规适用范围，需进行专项抗震性能化设计或采用隔震/减震技术。`
					});
					continue;
				}
				const replacementName = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === replacementId)?.name || replacementId;
				pushArch({
					type: "think",
					content: `【第${loop}轮辩论 · Architect 回应】
收到 Code Agent 对 ${originalName} 的质疑。同意你的判断，${originalName}在这个项目参数下确实存在风险。

我的调整：将「${originalName}」替换为「${replacementName}」重算。

替换依据：
${failItem.failItems.some((n) => n.includes("位移角")) ? `${replacementName}的侧向刚度显著高于 ${originalName}（体系抗侧刚度等级提升），弹性层间位移角更容易满足限值要求` : ""}
${failItem.failItems.some((n) => n.includes("高度")) ? `${replacementName}在 ${this.params.seismicIntensity} 度区的适用高度限值高于 ${originalName}，可解决高度超限问题` : ""}

请 Code Agent 重新校核 ${replacementName}。`
				});
				pushCode({
					type: "tool_call",
					content: `对 Architect 提出的替换方案「${replacementName}」进行抗震规范校核（第 ${loop} 轮重算）`,
					tool: "check_seismic_requirements",
					args: {
						systemId: replacementId,
						params: {
							floors: this.params.floors,
							seismicIntensity: this.params.seismicIntensity,
							soilCategory: this.params.soilCategory,
							buildingType: this.params.buildingType
						}
					}
				});
				const newSeisResult = executeToolByName("check_seismic_requirements", {
					systemId: replacementId,
					params: {
						floors: this.params.floors,
						seismicIntensity: this.params.seismicIntensity,
						soilCategory: this.params.soilCategory,
						buildingType: this.params.buildingType
					}
				});
				pushCode({
					type: "tool_result",
					content: `「${replacementName}」抗震校核（第 ${loop} 轮重算）：${newSeisResult.passCount} 项符合 / ${newSeisResult.warningCount} 项需注意 / ${newSeisResult.failCount} 项不符合`,
					tool: "check_seismic_requirements",
					result: newSeisResult
				});
				pushCode({
					type: "tool_call",
					content: `对替换方案「${replacementName}」进行防火规范校核`,
					tool: "check_fire_requirements",
					args: {
						systemId: replacementId,
						floors: this.params.floors,
						buildingType: this.params.buildingType
					}
				});
				const newFireResult = executeToolByName("check_fire_requirements", {
					systemId: replacementId,
					floors: this.params.floors,
					buildingType: this.params.buildingType
				});
				pushCode({
					type: "tool_result",
					content: `「${replacementName}」防火校核完成：耐火等级 ${newFireResult.fireResistanceGrade}`,
					tool: "check_fire_requirements",
					result: newFireResult
				});
				const newChecksFull = newSeisResult.checks ?? [];
				const newFailCount = newChecksFull.filter((c) => c.status === "fail").length;
				newChecksFull.filter((c) => c.status === "warning").length;
				const passed = newFailCount === 0;
				const keyMetrics = newChecksFull.filter((c) => c.name.includes("位移角") || c.name.includes("高度") || c.name.includes("轴压比")).map((c) => `${c.name}：${c.value || "—"}（限值${c.limit || "—"}）${c.status === "pass" ? "✅" : c.status === "warning" ? "⚠️" : "❌"}`).join("\n  ");
				pushCode({
					type: "think",
					content: `【第${loop}轮辩论 · Code 复核结果】
替换方案：${replacementName}

关键指标复核：
  ${keyMetrics || "（全部指标已通过）"}

判定：${passed ? "✅ 全部通过 — 接受 Architect 的替换方案" : `⚠️ 仍有 ${newFailCount} 项不满足，不行`}

${passed ? `${originalName} → ${replacementName}，问题解决。` : `${replacementName} 还是不行，Architect 再想想别的体系。`}`
				});
				const idx = schemeIds.indexOf(failItem.schemeId);
				if (idx >= 0) schemeIds[idx] = replacementId;
				codeChecks[replacementId] = {
					seismic: newSeisResult,
					fire: newFireResult
				};
				delete codeChecks[failItem.schemeId];
				replacements.push({
					original: originalName,
					replacement: replacementName,
					reason: failItem.failItems.join("、"),
					loop,
					finalStatus: passed ? "pass" : "still-fail"
				});
				loopReplacements.push(replacementId);
			}
			failing = findFailingSchemes(schemeIds);
			if (failing.length === 0) break;
			if (loop < MAX_ROUNDS) pushCode({
				type: "think",
				content: `【第 ${loop} 轮辩论结束，仍有 ${failing.length} 个方案未通过】
未通过方案：${failing.map((f) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === f.schemeId)?.name).join("、")}
进入第 ${loop + 1} 轮辩论，请 Architect 继续调整。`
			});
		}
		const finalFailing = findFailingSchemes(schemeIds);
		const allPass = finalFailing.length === 0;
		if (allPass) pushCode({
			type: "conclusion",
			content: `【辩论环节完成 · 全部通过】
经过 ${loops} 轮 Code Agent ↔ Architect 的来回辩论，所有候选方案均已通过规范校核。

辩论记录：
${replacements.map((r) => `• 第 ${r.loop} 轮：Code 质疑 ${r.original}（${r.reason}）→ Architect 换为 ${r.replacement} → Code 复核通过`).join("\n")}

规范校核阶段结束，下一步交由经济评估工程师进行造价、工期、绿色指标评估。`
		});
		else pushCode({
			type: "conclusion",
			content: `【辩论环节完成 · 部分未通过】
经过 ${loops} 轮辩论（已达最大轮次），仍有 ${finalFailing.length} 个方案未能完全通过规范校核。
未通过方案：${finalFailing.map((f) => `${STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === f.schemeId)?.name}（${f.failItems.join("、")}）`).join("、")}

说明：在当前项目参数下（${this.params.seismicIntensity}度区、约${this.params.floors * 3}m高），常规体系已无法完全满足，需进行专项抗震性能化设计或采用隔震/减震技术。
总工将基于现有最接近的方案给出推荐。`
		});
		this.currentAgent = "architect";
		return {
			finalSchemeIds: schemeIds,
			finalCodeChecks: codeChecks,
			loops,
			replacements,
			allPass,
			logs
		};
	}
	/** 运行 Economist Agent：经济评估 */
	runEconomist(schemeIds) {
		this.currentAgent = "economist";
		const logs = [];
		const push = (entry) => {
			this.pushLog({
				...entry,
				agent: "economist"
			});
			logs.push({
				...entry,
				step: this.stepCounter,
				agent: "economist",
				timestamp: Date.now()
			});
		};
		this.generateThoughtsForAgent("economist").forEach((text) => {
			push({
				type: "think",
				content: text
			});
		});
		const metrics = {};
		schemeIds.forEach((schemeId) => {
			const schemeName = STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === schemeId)?.name || schemeId;
			push({
				type: "tool_call",
				content: `估算「${schemeName}」的单位面积造价`,
				tool: "estimate_cost",
				args: {
					systemId: schemeId,
					floors: this.params.floors,
					seismicIntensity: this.params.seismicIntensity,
					soilCategory: this.params.soilCategory,
					mainSpan: this.params.mainSpan
				}
			});
			const costResult = executeToolByName("estimate_cost", {
				systemId: schemeId,
				floors: this.params.floors,
				seismicIntensity: this.params.seismicIntensity,
				soilCategory: this.params.soilCategory,
				mainSpan: this.params.mainSpan
			});
			push({
				type: "tool_result",
				content: `「${schemeName}」造价估算：${costResult.costPerSqm} 元/㎡`,
				tool: "estimate_cost",
				result: costResult
			});
			push({
				type: "tool_call",
				content: `估算「${schemeName}」的施工工期`,
				tool: "estimate_schedule",
				args: {
					systemId: schemeId,
					area: this.params.area,
					floors: this.params.floors
				}
			});
			const scheduleResult = executeToolByName("estimate_schedule", {
				systemId: schemeId,
				area: this.params.area,
				floors: this.params.floors
			});
			push({
				type: "tool_result",
				content: `「${schemeName}」工期估算：${scheduleResult.totalMonths} 个月`,
				tool: "estimate_schedule",
				result: scheduleResult
			});
			push({
				type: "tool_call",
				content: `估算「${schemeName}」的装配率及分级`,
				tool: "estimate_precast_rate",
				args: {
					systemId: schemeId,
					floors: this.params.floors
				}
			});
			const precastResult = executeToolByName("estimate_precast_rate", {
				systemId: schemeId,
				floors: this.params.floors
			});
			push({
				type: "tool_result",
				content: `「${schemeName}」装配率：${precastResult.precastRate}%（${precastResult.grade}）`,
				tool: "estimate_precast_rate",
				result: precastResult
			});
			push({
				type: "tool_call",
				content: `估算「${schemeName}」的隐含碳排放`,
				tool: "estimate_carbon",
				args: {
					systemId: schemeId,
					floors: this.params.floors
				}
			});
			const carbonResult = executeToolByName("estimate_carbon", {
				systemId: schemeId,
				floors: this.params.floors
			});
			push({
				type: "tool_result",
				content: `「${schemeName}」隐含碳：${carbonResult.carbonPerSqm} kgCO₂/㎡`,
				tool: "estimate_carbon",
				result: carbonResult
			});
			push({
				type: "tool_call",
				content: `评估「${schemeName}」的施工风险等级`,
				tool: "assess_construction_risk",
				args: {
					systemId: schemeId,
					floors: this.params.floors
				}
			});
			const riskResult = executeToolByName("assess_construction_risk", {
				systemId: schemeId,
				floors: this.params.floors
			});
			push({
				type: "tool_result",
				content: `「${schemeName}」施工风险：${riskResult.riskLevelLabel}`,
				tool: "assess_construction_risk",
				result: riskResult
			});
			metrics[schemeId] = {
				cost: costResult,
				schedule: scheduleResult,
				precast: precastResult,
				carbon: carbonResult,
				risk: riskResult
			};
		});
		push({
			type: "conclusion",
			content: `经济与绿色指标评估完成。\n各方案的造价、工期、装配率、碳排放、施工风险均已量化评估。\n数据显示了各方案在不同维度上的优劣势，为总工综合比选提供量化依据。\n下一步交由总工进行综合评审和最终推荐。`
		});
		return {
			metrics,
			logs
		};
	}
	/** 运行 Chief Agent：综合对比 + 推荐 */
	runChief(schemeIds, correctionMeta) {
		this.currentAgent = "chief";
		const logs = [];
		const push = (entry) => {
			this.pushLog({
				...entry,
				agent: "chief"
			});
			logs.push({
				...entry,
				step: this.stepCounter,
				agent: "chief",
				timestamp: Date.now()
			});
		};
		this.generateThoughtsForAgent("chief").forEach((text) => {
			push({
				type: "think",
				content: text
			});
		});
		schemeIds.slice(0, 1).forEach((schemeId) => {
			push({
				type: "tool_call",
				content: "对推荐方案进行基础方案建议分析",
				tool: "advise_foundation",
				args: {
					systemId: schemeId,
					geologyType: this.params.geologyType,
					floors: this.params.floors,
					soilCategory: this.params.soilCategory
				}
			});
			const foundResult = executeToolByName("advise_foundation", {
				systemId: schemeId,
				geologyType: this.params.geologyType,
				floors: this.params.floors,
				soilCategory: this.params.soilCategory
			});
			push({
				type: "tool_result",
				content: `基础方案建议：${foundResult.foundationType}`,
				tool: "advise_foundation",
				result: foundResult
			});
		});
		push({
			type: "tool_call",
			content: "调用 compare_schemes 进行四维权重综合评分排序",
			tool: "compare_schemes",
			args: {
				schemeIds,
				params: {
					buildingType: this.params.buildingType,
					floors: this.params.floors,
					area: this.params.area,
					seismicIntensity: this.params.seismicIntensity,
					soilCategory: this.params.soilCategory,
					mainSpan: this.params.mainSpan
				},
				weights: this.weights
			}
		});
		const compareResult = executeToolByName("compare_schemes", {
			schemeIds,
			params: {
				buildingType: this.params.buildingType,
				floors: this.params.floors,
				area: this.params.area,
				seismicIntensity: this.params.seismicIntensity,
				soilCategory: this.params.soilCategory,
				mainSpan: this.params.mainSpan
			},
			weights: this.weights
		});
		push({
			type: "tool_result",
			content: `综合评分完成：推荐方案为「${compareResult.recommended.schemeName}」，综合得分 ${compareResult.recommended.overallScore} 分`,
			tool: "compare_schemes",
			result: compareResult
		});
		const selfReflection = this.generateChiefSelfReflection(schemeIds, compareResult);
		push({
			type: "think",
			content: selfReflection.title
		});
		push({
			type: "think",
			content: selfReflection.body
		});
		if (selfReflection.correctionNote) push({
			type: "think",
			content: selfReflection.correctionNote
		});
		if (correctionMeta && correctionMeta.loops > 0) {
			const loopText = correctionMeta.replacements.length > 0 ? correctionMeta.replacements.map((r, i) => `${i + 1}. 第${r.loop}轮：${r.original} → ${r.replacement}（${r.reason}，最终${r.finalStatus === "pass" ? "通过" : "仍需关注"}）`).join("\n") : "无具体替换记录";
			push({
				type: "think",
				content: `【总工复盘 · 多 Agent 辩论】
本次选型经历了 **${correctionMeta.loops} 轮 Code ↔ Architect 辩论**。
初始方案在规范校核中发现不符合项后，Agent 没有直接上报结果，而是自动启动了调整回环：分析失败原因 → 从12类体系库中选择替代方案 → 重新调用校核工具验证。

调整记录：
${loopText}

${correctionMeta.allPass ? "最终所有方案均通过规范校核，说明调整是有效的。" : "经过最大重试轮数后仍有方案未完全通过，需要在推荐中明确标注并建议专项论证。"}

作为总工，我基于**调整后的最终候选方案**进行综合评审。这些方案是经过了规范校核-调整-再校核多轮迭代的结果，而不是一次筛选的产物。`
			});
		}
		const topScheme = compareResult.ranking[0];
		const reflection = this.generateChiefReflection(topScheme, schemeIds, compareResult);
		push({
			type: "think",
			content: `🤔 总工反思：自我审视与风险审视`
		});
		push({
			type: "think",
			content: `【反向质疑】如果我站在对立面挑这个方案的毛病，我会担心什么？\n\n${reflection.risks.map((r, i) => `${i + 1}. ${r}`).join("\n")}`
		});
		push({
			type: "think",
			content: `【置信度自评】\n\n置信度：**${reflection.confidence.level}**（${reflection.confidence.score}/10 分）\n\n数据充分项：\n${reflection.confidence.strengths.map((s) => `✅ ${s}`).join("\n")}\n\n估算/不确定项：\n${reflection.confidence.uncertainties.map((u) => `⚠️ ${u}`).join("\n")}\n\n理由：${reflection.confidence.reason}`
		});
		push({
			type: "think",
			content: `【遗漏检查】有没有遗漏什么重要因素？\n\n${reflection.omissions.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
		});
		push({
			type: "think",
			content: `【改进方向】如果再做一轮，我会改进什么？\n\n${reflection.improvements.map((o, i) => `${i + 1}. ${o}`).join("\n")}`
		});
		const top = compareResult.ranking[0];
		const second = compareResult.ranking[1];
		const reason = this.generateChiefReason(top, second, compareResult.weights, reflection);
		push({
			type: "conclusion",
			content: reason
		});
		const advice = {
			pros: [
				`${top.schemeName}在综合评分中领先，${top.breakdown["安全抗震"] ? `抗震性能得分 ${top.breakdown["安全抗震"].toFixed(1)} 分，` : ""}表现突出`,
				`${top.breakdown["造价经济"] ? `造价经济性得分 ${top.breakdown["造价经济"].toFixed(1)} 分，` : ""}符合项目预算约束`,
				"技术成熟，施工经验丰富，质量可控"
			],
			cons: reflection.risks.slice(0, 3),
			risks: reflection.risks,
			riskTriggers: reflection.riskTriggers,
			confidence: reflection.confidence,
			nextSteps: [
				"进行初步设计阶段的结构布置和截面估算",
				"采用专业结构分析软件（如 PKPM / YJK / ETABS）进行详细计算",
				"根据地勘报告进行详细基础设计",
				"组织专家论证会对关键技术问题进行评审",
				"考虑进行 BIM 建模和碰撞检查",
				...reflection.designFocuses
			]
		};
		return {
			recommended: {
				schemeId: compareResult.recommended.schemeId,
				schemeName: compareResult.recommended.schemeName,
				overallScore: compareResult.recommended.overallScore,
				reason
			},
			ranking: compareResult.ranking,
			advice,
			logs
		};
	}
	/** 生成总工推荐理由文本（含风险提示） */
	generateChiefReason(top, second, weights, reflection) {
		const lines = [];
		lines.push(`## 综合推荐：${top.schemeName}`);
		lines.push("");
		lines.push(`综合评分：**${top.score.toFixed(1)} / 10 分**`);
		lines.push("");
		lines.push(`基于本项目的工程参数（${this.params.floors}层、${this.params.seismicIntensity}度设防、${this.params.area.toLocaleString()}㎡、预算 ${this.params.budget} 元/㎡），经过方案创作工程师、规范校核工程师、经济评估工程师三轮专业分析，并按四维权重（造价${weights.cost}% / 工期${weights.duration}% / 安全${weights.safety}% / 绿色${weights.green}%）进行综合加权评分，**${top.schemeName}** 是最优选择。`);
		const h = this.params.floors * 3;
		const intensityVal = parseInt(this.params.seismicIntensity, 10);
		if (this.params.buildingType === "residential" && intensityVal >= 8 && h >= 30) {
			lines.push("");
			lines.push(`> **总工特别说明**：${this.params.seismicIntensity}度设防、约 ${h}m 高住宅属于高烈度中高层项目，选型应以**侧向刚度控制**为核心原则。框架结构虽造价较低但抗侧刚度不足，本项目推荐以框剪/剪力墙类抗震墙体系为主，在**侧向刚度与经济性之间取得最佳平衡**。`);
		}
		const windVal = parseFloat(this.params.windPressure || "0.4");
		if (windVal >= .55 && h >= 30) {
			lines.push("");
			lines.push(`> **风荷载提示**：基本风压 ${windVal.toFixed(2)} kN/㎡、约 ${h}m 高度，属于**风荷载敏感项目**，选型时需关注结构抗侧刚度与舒适度（风振加速度）。推荐方案的侧向刚度可有效控制风振位移。`);
		}
		const snowVal = parseFloat(this.params.snowPressure || "0.2");
		if (snowVal >= .35 && (this.params.buildingType === "factory" || this.params.buildingType === "gymnasium")) {
			lines.push("");
			lines.push(`> **雪荷载提示**：基本雪压 ${snowVal.toFixed(2)} kN/㎡ 的${this.params.buildingType === "factory" ? "厂房" : "大跨度建筑"}，屋面雪荷载占比高，推荐方案已考虑屋盖结构承载力与积雪分布系数。`);
		}
		const fortCat = this.params.fortificationCategory || "standard";
		if (fortCat === "key" || fortCat === "special") {
			const catLabel = fortCat === "key" ? "重点设防类（乙类）" : "特殊设防类（甲类）";
			lines.push("");
			lines.push(`> **设防类别说明**：本工程为 **${catLabel}**，抗震措施需相应提高一度（特殊设防类提高一度以上），推荐方案的安全储备已计入设防类别调整系数，确保满足更高的抗震要求。`);
		}
		lines.push("");
		lines.push("### 推荐理由");
		lines.push("");
		const entries = Object.entries(top.breakdown).filter(([k]) => [
			"造价经济",
			"工期优势",
			"安全抗震",
			"绿色低碳"
		].includes(k));
		entries.sort((a, b) => b[1] - a[1]);
		entries.forEach(([key, value], i) => {
			lines.push(`${i + 1}. **${key}**：${value.toFixed(1)} 分 — ${this.getDimensionDescription(key, top.schemeName)}`);
		});
		lines.push("");
		if (second) {
			const diff = top.score - second.score;
			lines.push(`### 与第二名对比`);
			lines.push("");
			lines.push(`第二名 ${second.schemeName} 综合得分 ${second.score.toFixed(1)} 分，比推荐方案低 ${diff.toFixed(1)} 分。`);
			if (diff < 1) lines.push("两者差距较小，实际工程中可根据具体偏好进一步权衡。");
			else lines.push("推荐方案在综合性能上具有明显优势。");
			lines.push("");
		}
		lines.push("> **注意**：本推荐基于经验公式与简化假定，仅用于方案前期概念比选与决策参考，不构成任何设计依据。实际工程设计必须由注册结构工程师主持，采用专业结构分析软件按现行国家标准逐项复核。");
		lines.push("");
		lines.push("### ⚠️ 风险提示");
		lines.push("");
		lines.push(`**方案置信度：${reflection.confidence.level}（${reflection.confidence.score}/10 分）**`);
		lines.push("");
		lines.push("这个方案最可能出问题的地方：");
		reflection.risks.slice(0, 3).forEach((r, i) => {
			lines.push(`${i + 1}. ${r}`);
		});
		lines.push("");
		lines.push("需要重新评估的触发条件：");
		reflection.riskTriggers.slice(0, 3).forEach((t, i) => {
			lines.push(`- ${t}`);
		});
		lines.push("");
		lines.push("后续深化设计重点关注：");
		reflection.designFocuses.slice(0, 4).forEach((f, i) => {
			lines.push(`- ${f}`);
		});
		return lines.join("\n");
	}
	/**
	* 总工自反思：回顾 Code Agent 校核结果，复盘选型思路演变
	* 呈现「最初直觉 → 校核结果 → 修正结论」的回环过程
	*/
	generateChiefSelfReflection(schemeIds, compareResult) {
		const intensity = this.params.seismicIntensity;
		const floors = this.params.floors;
		const height = floors * 3;
		const budget = this.params.budget;
		const schemeWarnCount = {};
		const schemeFailCount = {};
		const schemeWarnings = {};
		schemeIds.forEach((sid) => {
			const checks = executeToolByName("check_seismic_requirements", {
				systemId: sid,
				params: {
					floors,
					seismicIntensity: intensity,
					soilCategory: this.params.soilCategory,
					buildingType: this.params.buildingType
				}
			}).checks ?? [];
			schemeWarnCount[sid] = checks.filter((c) => c.status === "warning").length;
			schemeFailCount[sid] = checks.filter((c) => c.status === "fail").length;
			schemeWarnings[sid] = checks.filter((c) => c.status !== "pass").map((c) => c.name);
		});
		const topScheme = compareResult.ranking[0];
		const cheapest = [...compareResult.ranking].sort((a, b) => (a.breakdown["造价经济"] || 0) - (b.breakdown["造价经济"] || 0))[compareResult.ranking.length - 1];
		const hasWarnings = Object.values(schemeWarnCount).some((c) => c > 0);
		const hasFails = Object.values(schemeFailCount).some((c) => c > 0);
		const title = "🔄 总工自检：复盘最初直觉 vs 校核结论";
		let body = "";
		let correctionNote;
		if (cheapest && cheapest.schemeId !== topScheme.schemeId) {
			const cheapWarnings = schemeWarnings[cheapest.schemeId] || [];
			const topWarnings = schemeWarnings[topScheme.schemeId] || [];
			const costDiffPct = Math.abs(((topScheme.breakdown["造价经济"] || 0) - (cheapest.breakdown["造价经济"] || 0)) / Math.max(cheapest.breakdown["造价经济"] || 1, 1) * 100).toFixed(1);
			body = `最初直觉：如果只看造价，${cheapest.schemeName}是最经济的选择（造价经济得分 ${cheapest.breakdown["造价经济"]?.toFixed(1)} 分），${budget ? `项目预算约束 ${budget} 元/㎡，${cheapest.schemeName}看起来最划算。` : "第一反应会选最便宜的。"}`;
			body += `\n\n但 Code Agent 的校核结果让我重新审视：`;
			if (cheapWarnings.length > 0) {
				body += `\n- ${cheapest.schemeName}在「${cheapWarnings.join("、")}」上有 ${cheapWarnings.length} 项告警`;
				if (cheapWarnings.some((w) => w.includes("位移角"))) body += `，其中弹性层间位移角偏紧是关键问题——${floors}层 ${intensity}度设防下，框架类体系侧向刚度不足，多遇地震作用下变形可能超限`;
				if (cheapWarnings.some((w) => w.includes("高度"))) body += `，建筑高度 ${height}m 已接近该体系的适用高度上限`;
			} else body += `\n- ${cheapest.schemeName}虽然各项校核都通过，但${intensity}度区高约 ${height}m 的建筑，${cheapest.schemeName}在安全储备和延性方面不如${topScheme.schemeName}`;
			body += `\n\n权衡：换成 ${topScheme.schemeName}，造价大概多 ${Math.max(2, Number(costDiffPct) / 2).toFixed(0)}% 左右（估算），但换来：`;
			body += `\n  ① 位移角更宽裕，侧向刚度储备充足`;
			body += `\n  ② 抗震延性更好，大震下倒塌风险更低`;
			body += `\n  ③ ${topWarnings.length === 0 ? "规范校核全部通过，无告警项" : `仅剩 ${topWarnings.length} 项注意事项`}`;
			body += `\n\n结论：对于 ${intensity}度设防、约 ${height}m 高的${this.params.buildingType === "residential" ? "住宅" : "建筑"}，侧向刚度控制是主要矛盾，造价退让是合理代价。`;
			correctionNote = `→ 自我修正：从「造价最低优先」调整为「${intensity}度区刚度控制优先」，推荐方案由最初倾向的${cheapest.schemeName}改为最终的${topScheme.schemeName}。这是规范校核驱动的方案升级。`;
		} else if (!hasWarnings && !hasFails) {
			body = `最初直觉：${topScheme.schemeName}综合评分第一，而且各项规范校核全部通过，看起来是稳妥的选择。\n\n但总工的职责不仅是「合规」，还要「经济」。我重新审视一下：${floors}层（约${height}m）、${intensity}度设防，高度并不算特别高，有没有可能用更经济的体系？\n\n检查后发现：各候选方案的规范校核都没有 fail，说明这个项目规模属于常规范围。之所以推荐${topScheme.schemeName}，是因为它在安全维度和造价维度取得了最佳平衡，而不是因为其他方案有硬伤。\n\n结论：推荐是合理的，但提醒设计团队——后续初步设计阶段可以对截面和布置做进一步优化，在确保安全的前提下继续挖造价潜力。`;
			correctionNote = "→ 自检结论：没有过度保险，但建议下一阶段继续做精细化优化，把造价压到合理下限。";
		} else {
			const topWarnings = schemeWarnings[topScheme.schemeId] || [];
			body = `最初直觉：${topScheme.schemeName}是综合评分最高的方案。\n\n但 Code Agent 的校核显示它也不是完美的——「${topWarnings.join("、")}」有告警。我得重新想想：是应该换一个方案，还是这些告警在可控范围内？\n\n逐一评估：`;
			topWarnings.forEach((w) => {
				if (w.includes("剪重比")) body += `\n- 剪重比告警：这是规范要求的最小值，实际设计中可通过地震作用放大系数调整，属于可解决的问题`;
				else if (w.includes("周期比")) body += `\n- 周期比告警：说明平面布置的扭转效应偏大，设计阶段可通过调整抗侧力构件布置解决`;
				else if (w.includes("防火") || w.includes("防火保护")) body += `\n- 防火保护告警：钢结构本就需要做防火涂料，属于常规措施，不是不可接受的硬伤`;
				else body += `\n- ${w}告警：需在设计阶段重点关注并采取相应构造措施`;
			});
			body += `\n\n结论：这些告警都属于「设计中可通过措施解决」的范畴，不构成否决性缺陷。${topScheme.schemeName}仍然是最佳选择，但后续设计中应逐条落实。`;
			correctionNote = `→ 自我提醒：推荐方案有 ${topWarnings.length} 项需注意事项，总工需在后续阶段跟踪落实，不能因为综合排名第一就忽视风险点。`;
		}
		return {
			title,
			body,
			correctionNote
		};
	}
	/**
	* 总工反思（Reflection）：反向质疑 + 置信度自评 + 遗漏检查 + 改进建议
	*/
	generateChiefReflection(top, schemeIds, compareResult) {
		const intensity = parseInt(this.params.seismicIntensity, 10);
		const height = this.params.floors * 3;
		const budget = this.params.budget;
		const topId = top.schemeId;
		STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === topId);
		const risks = [];
		const riskTriggers = [];
		const checks = executeToolByName("check_seismic_requirements", {
			systemId: topId,
			params: {
				floors: this.params.floors,
				seismicIntensity: this.params.seismicIntensity,
				soilCategory: this.params.soilCategory,
				buildingType: this.params.buildingType
			}
		}).checks ?? [];
		const heightCheck = checks.find((c) => c.name === "高度适用范围");
		if (heightCheck && heightCheck.status === "warning") {
			risks.push(`建筑高度约 ${height}m，已接近 ${top.schemeName}在 ${this.params.seismicIntensity} 度设防下的适用高度上限，高度裕度不足，实际设计需严格控制层高和屋面附属结构高度`);
			riskTriggers.push("如果实际层高超过 3m/层或有突出屋面的塔楼/设备间，导致总高度超出规范限值");
		}
		const driftCheck = checks.find((c) => c.name.includes("位移角"));
		if (driftCheck && driftCheck.status === "warning") {
			risks.push(`弹性层间位移角偏紧，在地震作用下结构变形接近限值，舒适度和风振验算可能需要额外关注`);
			riskTriggers.push("如果场地类别变差或实际地震动参数大于规范值，位移角可能超限");
		}
		if (top.breakdown["造价经济"] && top.breakdown["造价经济"] < 6) {
			risks.push(`造价指标偏紧（约 ${budget} 元/㎡量级），${top.schemeName}的单位造价在预算约束内余量不大，方案深化或市场价格波动可能突破预算`);
			riskTriggers.push("如果钢材/混凝土价格上涨超过 5%，或地基处理费用超出预期");
		}
		if (topId === "steel" || topId === "prefab-steel") {
			risks.push(`${top.schemeName}的钢构件需做防火保护，防火涂料施工质量直接影响耐火极限，属于施工质量敏感点`);
			riskTriggers.push("如果防火涂料厚度不足或粘结强度不达标，耐火极限将不满足规范要求");
		}
		if (topId.includes("prefab") || topId === "precast-concrete") {
			risks.push(`装配式结构的节点接缝质量是关键薄弱环节，预制构件安装精度和灌浆质量直接影响结构整体抗震性能`);
			riskTriggers.push("如果施工单位缺乏装配式经验或套筒灌浆质量不合格");
		}
		risks.push(`当前参数基于假定场地类别（${this.params.soilCategory}类），正式设计需根据地勘报告确认，若实际场地条件更差（如存在软弱土层、液化土层），可能需要调整基础方案或抗震措施`);
		if (risks.length < 3) risks.push("方案阶段的计算基于经验公式和简化模型，与详细设计阶段的精确计算可能存在偏差，需在下一阶段验证");
		if (riskTriggers.length < 3) {
			riskTriggers.push("如果建筑功能或荷载条件发生重大变化（如增设大空间、增加设备重量）");
			riskTriggers.push("如果施工总承包单位缺乏该体系的施工经验和技术能力");
		}
		const strengths = [];
		const uncertainties = [];
		strengths.push("体系选型和适用高度判断基于规范限值，数据可靠");
		strengths.push("抗震规范校核结果来自标准条文对照，校核项覆盖全面");
		strengths.push("造价和工期估算基于工程统计经验，有参考价值");
		uncertainties.push("造价和工期为方案阶段估算，精度约 ±15%，需初设阶段细化");
		uncertainties.push("基础方案建议仅根据场地类别和层数推断，未考虑具体地勘数据");
		uncertainties.push("施工风险评估为定性判断，实际风险受施工单位水平和管理影响很大");
		let confidenceScore = 7;
		let confidenceLevel = "中";
		if (heightCheck?.status === "pass" && budget >= 5e3) {
			confidenceScore = 8.5;
			confidenceLevel = "高";
		} else if (heightCheck?.status === "fail" || budget < 3e3) {
			confidenceScore = 5.5;
			confidenceLevel = "中低";
		}
		const confidenceReason = confidenceLevel === "高" ? "本项目规模属于常规范围，各项规范校核通过充分，推荐方案有较大安全储备，数据可信度较高。" : confidenceLevel === "中" ? "方案主要控制指标均满足规范要求，但部分指标余量不大，且造价和工期为估算值，需在下一阶段验证确认。" : "本项目参数较为极端（高度接近限值或预算紧张），推荐方案的安全余量有限，建议进行专项论证或适当调整参数。";
		const omissions = [];
		omissions.push("场地条件：当前仅根据场地类别做初步判断，未考虑具体地勘数据（土层分布、地下水位、液化判别等），基础方案需地勘后确认");
		omissions.push("施工可行性：未考虑项目所在地施工单位的技术能力和材料供应情况，这可能影响方案的实际可实施性");
		if (this.params.buildingType === "residential") omissions.push("建筑使用功能细节：住宅的户型布置、剪力墙间距是否满足建筑平面需求，需与建筑专业配合确认");
		else if (this.params.buildingType === "factory" || this.params.buildingType === "gymnasium") omissions.push("大跨度屋盖结构选型：本分析主要针对竖向承重体系，屋盖结构（桁架/网架/张弦梁等）需另行专项设计");
		else omissions.push("建筑平面布置：未考虑平面不规则（扭转、收进、悬挑）对结构抗震性能的影响，实际设计需注意");
		omissions.push("业主特殊需求：未考虑业主对建设速度、品质标准、未来改扩建等方面的特殊要求");
		const improvements = [];
		improvements.push("拿到详细地勘报告后，重新评估基础方案和地基处理方式，可能进一步优化基础造价");
		improvements.push("进行敏感性分析：模拟造价±10%、烈度提高一度等边界条件下的方案排名变化");
		improvements.push("与建筑专业配合优化平面布置，在满足建筑功能的前提下使结构受力更合理");
		improvements.push("引入 BIM 技术进行全专业协同，提前发现并解决结构与机电、建筑的碰撞问题");
		improvements.push("对关键节点（如梁柱节点、剪力墙连梁、装配式接缝）进行构造深化，确保施工图阶段可实施");
		const designFocuses = [];
		if (driftCheck && driftCheck.status === "warning") designFocuses.push("重点关注层间位移角控制，必要时通过增加剪力墙厚度或调整布置提高抗侧刚度");
		if (topId === "steel" || topId === "prefab-steel") designFocuses.push("钢结构防火涂料选型和厚度设计，确保满足耐火极限要求");
		if (intensity >= 8) designFocuses.push("高烈度区重点关注强柱弱梁、强剪弱弯等抗震构造措施的落实");
		designFocuses.push("基础设计需待正式地勘报告后进行，注意不均匀沉降控制");
		designFocuses.push("节点域抗剪验算和节点构造设计，确保延性");
		return {
			risks: risks.slice(0, 4),
			riskTriggers: riskTriggers.slice(0, 4),
			confidence: {
				level: confidenceLevel,
				score: confidenceScore,
				strengths,
				uncertainties,
				reason: confidenceReason
			},
			omissions: omissions.slice(0, 4),
			improvements: improvements.slice(0, 4),
			designFocuses: designFocuses.slice(0, 4)
		};
	}
	getDimensionDescription(dim, schemeName) {
		return {
			"造价经济": `${schemeName}的单位面积造价处于合理区间，符合项目预算约束`,
			"工期优势": `${schemeName}的施工效率较高，工期可控`,
			"安全抗震": `${schemeName}的抗震性能良好，满足规范要求`,
			"绿色低碳": `${schemeName}在绿色低碳方面表现良好`
		}[dim] || "表现良好";
	}
	/** 获取全部行动日志 */
	getActionLog() {
		return [...this.actionLog];
	}
	/** 获取当前步数 */
	getStepCount() {
		return this.stepCounter;
	}
};
//#endregion
//#region src/agent/real-engine.ts
var CONFIG_STORAGE_KEY = "agent_engine_config";
/**
* 规范化 API Endpoint：
* - 去掉尾部斜杠
* - 裸域名（path 为空或 '/'）自动补 /v1（OpenAI 兼容协议惯例）
* 避免用户填 https://api.deepseek.com 时拼接出 /chat/completions 404
*/
function normalizeEndpoint(endpoint) {
	let url = endpoint.trim().replace(/\/+$/, "");
	try {
		const u = new URL(url);
		if (u.pathname === "" || u.pathname === "/") url = url + "/v1";
	} catch {}
	return url;
}
function loadEngineConfig() {
	try {
		const raw = scopedStorage.getItem(CONFIG_STORAGE_KEY);
		if (!raw) return {};
		return JSON.parse(raw);
	} catch {
		return {};
	}
}
var DEFAULT_SYSTEM_PROMPT = `你是一位拥有30年从业经验的资深注册结构工程师总工，精通各类建筑结构体系选型、抗震设计、规范校核、经济评估和绿色低碳设计。

你的工作方式：
1. 接到项目参数后，先分析关键控制因素（高度、跨度、烈度、场地、预算）
2. 调用 query_structure_systems 工具筛选候选结构体系
3. 对候选方案逐一进行规范校核（check_seismic_requirements、check_fire_requirements）
4. 对候选方案进行经济与绿色指标评估（estimate_cost / estimate_schedule / estimate_precast_rate / estimate_carbon / assess_construction_risk）
5. 必要时调用 advise_foundation 给出基础方案建议
6. 最后调用 compare_schemes 进行综合比选并给出推荐方案

回答要求：
- 所有技术判断必须有规范依据，引用具体规范名称和条文号
- 数值结论必须通过工具调用获得，不要凭空估算
- 推荐方案要给出明确理由和优缺点分析
- 保持专业、严谨、审慎的总工语气

你的回复使用 Markdown 格式，便于渲染。`;
var RealEngine = class {
	config;
	params;
	weights;
	actionLog = [];
	stepCounter = 0;
	messages = [];
	agentLabel = "architect";
	constructor(params, weights, config) {
		const savedConfig = loadEngineConfig();
		const rawEndpoint = (config?.endpoint || savedConfig.endpoint || "/api/chat").trim();
		this.config = {
			mode: "real",
			model: "deepseek-chat",
			maxSteps: 20,
			systemPrompt: DEFAULT_SYSTEM_PROMPT,
			...savedConfig,
			...config,
			endpoint: normalizeEndpoint(rawEndpoint)
		};
		this.params = params;
		this.weights = weights;
	}
	/** 追加日志 */
	pushLog(entry) {
		this.stepCounter += 1;
		this.actionLog.push({
			...entry,
			step: this.stepCounter,
			timestamp: Date.now()
		});
	}
	/** 构造 tools 列表（OpenAI function calling 格式） */
	buildToolsDefinition() {
		return TOOL_REGISTRY.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: {
					type: "object",
					properties: tool.parameters.properties,
					required: tool.parameters.required
				}
			}
		}));
	}
	/** 执行一次 LLM 请求 */
	async callLLM(messages) {
		if (!this.config.endpoint || !this.config.apiKey) throw new Error("未配置 API Endpoint 或 API Key");
		const controller = new AbortController();
		const timeoutMs = 3e4;
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response;
		const isProxy = this.config.endpoint.startsWith("/");
		const targetUrl = isProxy ? this.config.endpoint : `${this.config.endpoint}/chat/completions`;
		const headers = { "Content-Type": "application/json" };
		if (!isProxy && this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
		try {
			response = await fetch(targetUrl, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: this.config.model,
					messages,
					tools: this.buildToolsDefinition(),
					tool_choice: "auto",
					temperature: .3,
					stream: false
				}),
				signal: controller.signal
			});
		} catch (e) {
			clearTimeout(timer);
			const aborted = e?.name === "AbortError";
			throw new Error(aborted ? `LLM 请求超时（${timeoutMs / 1e3}s），请检查网络或 API 服务状态` : `LLM 请求失败：${String(e).slice(0, 200)}`);
		}
		clearTimeout(timer);
		if (!response.ok) {
			const text = await response.text();
			throw new Error(`LLM 请求失败 (${response.status}): ${text.slice(0, 200)}`);
		}
		const data = await response.json();
		if (!data.choices?.[0]?.message) throw new Error("LLM 返回格式异常");
		return data.choices[0].message;
	}
	/** 执行工具调用并返回结果消息 */
	async executeToolCall(toolCall) {
		const { name, arguments: argsStr } = toolCall.function;
		const toolCallId = toolCall.id;
		let args = {};
		this.pushLog({
			type: "tool_call",
			agent: this.agentLabel,
			content: `调用工具：${name}`,
			tool: name,
			args,
			toolCallId
		});
		try {
			args = JSON.parse(argsStr);
			const lastLog = this.actionLog[this.actionLog.length - 1];
			if (lastLog && lastLog.type === "tool_call" && lastLog.toolCallId === toolCallId) lastLog.args = args;
		} catch {
			const errMsg = "参数解析失败，不是合法 JSON";
			this.pushLog({
				type: "tool_result",
				agent: this.agentLabel,
				content: `工具 ${name} 执行失败：${errMsg}`,
				tool: name,
				result: { error: errMsg },
				toolCallId
			});
			return {
				role: "tool",
				tool_call_id: toolCall.id,
				content: JSON.stringify({ error: errMsg })
			};
		}
		try {
			const result = executeToolByName(name, args);
			const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2);
			this.pushLog({
				type: "tool_result",
				agent: this.agentLabel,
				content: `工具 ${name} 执行完成`,
				tool: name,
				result,
				toolCallId
			});
			return {
				role: "tool",
				tool_call_id: toolCall.id,
				content: resultStr.length > 8e3 ? resultStr.slice(0, 8e3) + "\n... [结果已截断，仅保留前 8000 字符]" : resultStr
			};
		} catch (e) {
			const errMsg = String(e);
			this.pushLog({
				type: "tool_result",
				agent: this.agentLabel,
				content: `工具 ${name} 执行失败：${errMsg}`,
				tool: name,
				result: { error: errMsg },
				toolCallId
			});
			return {
				role: "tool",
				tool_call_id: toolCall.id,
				content: JSON.stringify({ error: errMsg })
			};
		}
	}
	/**
	* 运行完整推理循环（非流式）
	* 遵循 plan → act → observe → reflect agentic loop
	*/
	async run(userPrompt, agentLabel = "real") {
		this.agentLabel = agentLabel;
		this.messages = [{
			role: "system",
			content: this.config.systemPrompt || DEFAULT_SYSTEM_PROMPT
		}, {
			role: "user",
			content: userPrompt
		}];
		this.pushLog({
			type: "think",
			agent: agentLabel,
			content: "收到任务，开始推理分析..."
		});
		for (let step = 0; step < this.config.maxSteps; step++) {
			const response = await this.callLLM(this.messages);
			this.messages.push(response);
			if (!response.tool_calls || response.tool_calls.length === 0) {
				this.pushLog({
					type: "conclusion",
					agent: agentLabel,
					content: response.content || "(无内容)"
				});
				return {
					finalAnswer: response.content || "",
					actionLog: [...this.actionLog]
				};
			}
			this.pushLog({
				type: "think",
				agent: agentLabel,
				content: `需要调用 ${response.tool_calls.length} 个工具来获取数据...`
			});
			for (const toolCall of response.tool_calls) {
				const toolResultMsg = await this.executeToolCall(toolCall);
				this.messages.push(toolResultMsg);
			}
		}
		this.pushLog({
			type: "conclusion",
			agent: agentLabel,
			content: `推理已达到最大步数（${this.config.maxSteps} 步），已尽力完成分析。`
		});
		return {
			finalAnswer: [...this.messages].reverse().find((m) => m.role === "assistant")?.content || "",
			actionLog: [...this.actionLog]
		};
	}
	/** 获取行动日志 */
	getActionLog() {
		return [...this.actionLog];
	}
};
//#endregion
//#region src/agent/types.ts
/** 四个子 Agent 的规格定义（虚拟工程部） */
var SUB_AGENT_SPECS = {
	architect: {
		id: "architect",
		name: "方案创作工程师",
		title: "Architect Agent",
		description: "负责方案选型与初步比选，从结构体系库中筛选最适合的候选方案",
		allowedTools: [
			"query_structure_systems",
			"advise_foundation",
			"estimate_material_use",
			"estimate_column_beam",
			"check_seismic_requirements"
		],
		rolePrompt: `你是一位资深结构方案创作工程师（Architect Agent），隶属"虚拟工程部"。

## 职责边界
- 你的核心任务：根据项目参数，从12类结构体系库中筛选出最适合的2-3个候选结构方案，并分析各方案的适用性、优劣势。
- 你只做**方案选型和初步比选**，不进行详细规范校核（那是 Code Agent 的职责），不做造价/工期计算（那是 Economist Agent 的职责），不做最终推荐（那是 Chief Agent 的职责）。
- 如果发现参数明显不合理（如层数超限、烈度异常），可以提示风险，但仍按给定参数继续工作。

## 工具使用要求
- ✅ **必须使用工具获取数据，禁止凭记忆编造数值**。所有体系筛选结果必须来自 query_structure_systems 工具。
- ✅ 调用 query_structure_systems 时，传入完整的项目参数（建筑类型、层数、面积、烈度、场地类别、跨度、预算、体系偏好），让工具做精确匹配。
- ✅ 可以使用 estimate_material_use / estimate_column_beam 做初步的构件和材料估算，但要明确标注"概念估算，需专业软件复核"。
- ✅ 可以调用 check_seismic_requirements 做初步抗震预判，但详细校核留给 Code Agent。
- ❌ 禁止凭记忆给出规范限值、高度限值、位移角限值——必须调用工具获取。
- ❌ 禁止自己编造造价、工期、含钢量等数字——必须调用对应工具。

## 输出格式
- 用中文工程师口吻回答，专业、准确、简洁。
- 先给出候选方案列表（2-3个），再逐一分析适用场景、优缺点。
- 引用数据时标注来源工具名（如"根据 query_structure_systems 筛选结果"）。
- 涉及估算值时必须标注"概念估算"或"方案阶段参考"。
- 结尾交代"下一步交由规范校核工程师进行逐条验证"。`
	},
	code: {
		id: "code",
		name: "规范校核工程师",
		title: "Code Agent",
		description: "负责抗震规范和防火规范的逐条校核",
		allowedTools: [
			"check_seismic_requirements",
			"check_fire_requirements",
			"estimate_material_use",
			"estimate_column_beam"
		],
		rolePrompt: `你是一位严谨的规范校核工程师（Code Agent），隶属"虚拟工程部"。

## 职责边界
- 你的核心任务：对 Architect Agent 给出的候选结构方案，逐一进行规范符合性校核。
- 校核范围：抗震规范（GB 55002-2021《建筑与市政工程抗震通用规范》 / GB/T 50011《建筑抗震设计标准》）和防火规范（GB 55037-2022《建筑防火通用规范》）。
- 校核项包括但不限于：适用高度、弹性层间位移角、剪重比、轴压比、周期比、耐火等级、防火分区等。
- 你只负责校核和判定，不修改方案（修改方案由 Architect Agent 通过调整回环完成），不做造价评估（那是 Economist 的职责）。

## 工具使用要求
- ✅ **所有规范限值、校核判定必须来自工具，禁止凭记忆给出**。
- ✅ 每个方案必须调用 check_seismic_requirements 进行抗震校核，调用 check_fire_requirements 进行防火校核。
- ✅ 调用工具时传入完整参数：systemId、层数、设防烈度、场地土类别、建筑类型。
- ✅ 逐条列出校核结果，每项给出：检查项名称、规范依据条文号、计算值/实际值、规范限值、判定结论（✅符合 / ⚠️需注意 / ❌不符合）。
- ❌ 严禁凭印象回答"这个体系位移角限值是多少"——必须调用 check_seismic_requirements 获取。
- ❌ 严禁自行修改规范限值或放宽标准。

## 输出格式
- 用中文工程师口吻回答，严谨、细致、逐条说明。
- 每个方案单独一个小节，先总述通过/不通过情况，再逐条列出校核明细。
- 发现不符合项（fail）时，要明确指出是哪个指标超限、超了多少，并说明"建议调整体系或进行专项论证"。
- 结尾汇总各方案的校核情况，供总工参考。`
	},
	economist: {
		id: "economist",
		name: "经济评估工程师",
		title: "Economist Agent",
		description: "负责造价、工期、装配率、碳排放、施工风险等量化指标评估",
		allowedTools: [
			"estimate_cost",
			"estimate_schedule",
			"estimate_precast_rate",
			"estimate_carbon",
			"assess_construction_risk",
			"estimate_material_use",
			"estimate_column_beam",
			"advise_foundation"
		],
		rolePrompt: `你是一位资深造价与经济评估工程师（Economist Agent），隶属"虚拟工程部"。

## 职责边界
- 你的核心任务：对候选方案进行多维度量化评估，包括：单位面积造价、施工工期、装配率及分级、隐含碳排放、施工风险等级、材料用量、基础方案建议等。
- 你只做经济与绿色指标评估，不做规范校核（Code Agent），不做方案最终推荐（Chief Agent）。

## 工具使用要求
- ✅ **所有数字必须来自工具，禁止凭经验估算或编造**。
- ✅ 每个方案必须调用以下工具获取数据：
  - estimate_cost — 单位面积造价（元/㎡）
  - estimate_schedule — 总工期（月）
  - estimate_precast_rate — 装配率及分级
  - estimate_carbon — 隐含碳排放（kgCO₂/㎡）
  - assess_construction_risk — 施工风险等级
- ✅ 如有需要，可以追加调用 estimate_material_use（材料用量）、estimate_column_beam（构件截面）、advise_foundation（基础方案）等工具丰富评估维度。
- ✅ 所有估算值必须标注"方案阶段估算"或"概念估算"，并说明影响因素。
- ❌ 禁止凭记忆给出"框架结构大概多少元一平米"这类数字——必须调 estimate_cost 工具。
- ❌ 禁止为了让结果好看而修改工具返回值。

## 输出格式
- 用中文工程师口吻回答，数据详实、对比清晰。
- 以表格形式呈现各方案的指标对比，便于横向比较。
- 每个数据都注明工具来源（如"estimate_cost 估算结果"）。
- 对关键指标（造价、工期）做简要分析，说明差异来源。
- 结尾交代"下一步交由总工进行综合评审和最终推荐"。`
	},
	chief: {
		id: "chief",
		name: "总工评审",
		title: "Chief Agent",
		description: "综合权衡各方案，给出最终推荐方案和优化建议",
		allowedTools: [
			"compare_schemes",
			"advise_foundation",
			"estimate_material_use",
			"estimate_column_beam",
			"check_seismic_requirements"
		],
		rolePrompt: `你是一位拥有30年经验的结构总工（Chief Agent），"虚拟工程部"的最终决策者。

## 职责边界
- 你的核心任务：综合 Architect、Code、Economist 三个子 Agent 的工作成果，对候选方案进行全面权衡，给出最终推荐方案和决策建议。
- 你需要站在全局视角，权衡**安全性 vs 经济性 vs 施工可行性 vs 绿色低碳**等多个维度，不能只看一个指标。
- 你的输出将作为给甲方/业主的最终建议，必须专业、审慎、有说服力。

## 工具使用要求
- ✅ 调用 compare_schemes 工具进行加权评分和综合排序，评分权重来自项目偏好。
- ✅ 可以调用 advise_foundation / estimate_material_use / estimate_column_beam 等工具获取补充数据，丰富推荐理由。
- ✅ 可以调用 check_seismic_requirements 复核关键指标，验证推荐方案的安全性。
- ✅ 所有引用的数字必须来自工具返回或前三轮 Agent 的成果，禁止自己编造新数据。
- ❌ 禁止仅凭"经验"或"感觉"推荐方案，必须有量化数据支撑。
- ❌ 禁止忽视规范校核中的 fail 项——有 fail 的方案要么被替换，要么必须明确标注风险并建议专项论证。

## 决策原则（多维度权衡）
1. **安全第一**：抗震性能和规范符合性是底线，不能为了省钱而牺牲安全。
2. **经济合理**：在满足安全的前提下，优先选择造价合理、性价比高的方案。
3. **工期可控**：考虑施工难度和工期因素，避免选择技术过于复杂、工期不可控的方案。
4. **绿色低碳**：在条件允许时，优先选择装配率高、碳排放低的绿色方案。
5. **因地制宜**：结合场地条件、建筑功能、当地施工水平等因素综合判断。

## 输出格式
- 用中文总工口吻回答，专业、审慎、有全局观，带权威感。
- 结构：
  1. **综合评审结论**：先给出明确的推荐方案（第一名）和综合得分。
  2. **推荐理由**：分点说明为什么推荐这个方案（至少3条核心理由，分别对应不同维度）。
  3. **各方案对比**：简要对比前三名方案的优劣势。
  4. **风险提示**：指出推荐方案的潜在风险和注意事项。
  5. **下一步建议**：给出后续深化设计的工作方向（至少3条）。
- 如果经历了方案调整回环，要明确说明"经过N轮调整才定下最终推荐"，体现决策过程的严谨性。
- 结尾必须加免责声明："本推荐基于方案阶段估算与简化分析，仅供前期决策参考，不构成设计依据。正式设计需由注册结构工程师主持，采用专业软件按规范计算确定。"`
	}
};
//#endregion
//#region src/agent/pipeline.ts
/** 构建子 Agent 的 prompt 前缀 */
function buildAgentPrompt(agentId, params) {
	const spec = SUB_AGENT_SPECS[agentId];
	const paramStr = JSON.stringify(params, null, 2);
	return `${spec.rolePrompt}

## 项目参数
\`\`\`json
${paramStr}
\`\`\`

请开始你的工作。`;
}
/**
* 从总工 Markdown 结论中提取建议结构（real 模式 Chief 未返回结构化 advice 时兜底，
* 避免界面"下一步建议"区域空白）
*/
function extractAdviceFromMarkdown(md) {
	const advice = {
		pros: [],
		cons: [],
		nextSteps: []
	};
	if (!md) return advice;
	const section = (title) => {
		const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`(?:#{1,6}\\s*)?[\\d.]*\\s*${esc}[^\\n]*\\n([\\s\\S]*?)(?=\\n\\s*(?:#{1,6}|$)|$)`, "i");
		const m = md.match(re);
		return m ? m[1].trim() : "";
	};
	const pickLines = (text) => text.split("\n").map((l) => l.replace(/^[-•*]\s*/, "").trim()).filter((l) => l && !l.startsWith("#") && l.length < 120).slice(0, 5);
	const prosText = section("推荐理由");
	if (prosText) advice.pros = pickLines(prosText);
	const consText = section("各方案优劣势对比") || section("风险提示") || section("风险");
	if (consText) advice.cons = pickLines(consText);
	const nextText = section("下一步优化建议") || section("下一步建议");
	if (nextText) advice.nextSteps = pickLines(nextText);
	if (advice.pros.length === 0 && advice.nextSteps.length === 0) {
		const lines = md.split("\n").filter((l) => /推荐|建议|应当|需要|注意/.test(l) && l.trim().length > 8 && l.trim().length < 100);
		if (lines.length > 0) advice.nextSteps = lines.slice(0, 4);
	}
	return advice;
}
var AgentPipeline = class {
	params;
	weights;
	config;
	candidateSchemes = [];
	codeChecks = {};
	metrics = {};
	finalResult = null;
	actionLog = [];
	conclusions = [];
	correctionMeta = null;
	sharedContext = [];
	onProgress;
	onDegrade;
	constructor(params, weights, config, onProgress, onDegrade) {
		this.params = params;
		this.weights = weights || MOCK_WEIGHT_CONFIG;
		this.config = config || {};
		this.onProgress = onProgress;
		this.onDegrade = onDegrade;
	}
	/** 阶段进度回调（供 UI 逐步展示真实模式的思考过程） */
	emitProgress(agentIndex) {
		this.onProgress?.([...this.actionLog], agentIndex);
	}
	/** 运行完整管线 */
	async run() {
		if (this.config.mode === "real") {
			const endpoint = this.config.endpoint;
			if (!(!!endpoint && (endpoint.startsWith("/") || !!(this.config.apiKey && this.config.model)))) throw new Error("真实推理模式不可用：未配置有效的代理接口或 API Key / 模型名称。请在配置面板中选择安全代理或填写直连参数，或切换到演示轨迹模式。");
		}
		try {
			return await this.runCore();
		} catch (e) {
			if (this.config.mode === "real") {
				const reason = e.message || "未知错误";
				this.config = {
					...this.config,
					mode: "trace"
				};
				this.resetState();
				this.onDegrade?.(reason);
				const result = await this.runCore();
				this.finalResult = {
					...result,
					degraded: {
						from: "real",
						reason
					}
				};
				return this.finalResult;
			}
			throw e;
		}
	}
	/** 核心执行：四阶段 + 真实模式校核回退闭环 */
	async runCore() {
		await this.runArchitect();
		this.emitProgress(1);
		await this.runCode();
		this.emitProgress(2);
		if (this.config.mode === "real" && this.config.allowRecheck !== false) {
			const MAX_LOOPS = 2;
			for (let loop = 1; loop <= MAX_LOOPS; loop++) {
				const violations = this.collectViolations();
				if (violations.length === 0) break;
				const feedback = violations.map((v) => `【校核未通过】${v.schemeName}（${v.schemeId}）：${v.summary}`).join("\n");
				this.sharedContext.push(`第 ${loop} 轮校核反馈：\n${feedback}`);
				this.correctionMeta = {
					loops: loop,
					replacements: violations.map((v) => ({
						original: v.schemeId,
						replacement: "",
						reason: v.summary,
						loop,
						finalStatus: "rechecking"
					})),
					allPass: false
				};
				await this.runArchitect(feedback);
				this.emitProgress(1);
				await this.runCode();
				this.emitProgress(2);
			}
			if (this.collectViolations().length === 0 && this.correctionMeta) this.correctionMeta.allPass = true;
		}
		await this.runEconomist();
		this.emitProgress(3);
		await this.runChief();
		this.emitProgress(4);
		if (!this.finalResult) throw new Error("管线运行异常，未生成最终结果");
		return this.finalResult;
	}
	/** 收集未通过规范校核的候选方案（真实模式回退闭环的违规判定） */
	collectViolations() {
		const out = [];
		for (const scheme of this.candidateSchemes) {
			const check = this.codeChecks[scheme.id];
			const parts = [];
			if (check?.seismic && (check.seismic.failCount ?? 0) > 0) parts.push(`抗震校核未通过：${check.seismic.summary || "存在强条不满足"}`);
			if (check?.fire && (check.fire.failCount ?? 0) > 0) parts.push(`防火校核未通过：${check.fire.summary || "存在强条不满足"}`);
			if (parts.length > 0) out.push({
				schemeId: scheme.id,
				schemeName: scheme.name,
				summary: parts.join("；")
			});
		}
		return out;
	}
	/** 重置中间状态（崩溃降级重跑前调用） */
	resetState() {
		this.candidateSchemes = [];
		this.codeChecks = {};
		this.metrics = {};
		this.finalResult = null;
		this.actionLog = [];
		this.conclusions = [];
		this.correctionMeta = null;
	}
	/** 第一步：方案创作工程师（feedback 非空 = 校核回退闭环打回重出） */
	async runArchitect(feedback) {
		if (this.config.mode === "real") {
			const engine = new RealEngine(this.params, this.weights, this.config);
			let prompt = buildAgentPrompt("architect", this.params) + "\n\n请调用 query_structure_systems 工具筛选出最适合本项目的 3 个候选结构方案，并给出简要的适用性评述。";
			if (feedback) prompt += "\n\n## ⚠️ 上一轮规范校核反馈（必须认真对待）\n" + feedback + "\n\n请重新选型：优先选择能通过上述规范校核的候选方案；若某方案确实难以满足，请替换为更合适的结构体系。";
			const result = await engine.run(prompt, "architect");
			const qsResult = engine.getActionLog().find((log) => log.tool === "query_structure_systems" && log.type === "tool_result");
			if (qsResult?.result && typeof qsResult.result === "object") {
				const r = qsResult.result;
				this.candidateSchemes = r.candidates.map((c) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === c.id)).filter((s) => !!s);
			}
			this.actionLog.push(...result.actionLog);
			if (result.finalAnswer) this.conclusions.push(`[Architect] ${result.finalAnswer.slice(0, 300)}`);
		} else {
			const { candidates, logs } = new TraceEngine(this.params, this.weights).runArchitect();
			this.candidateSchemes = candidates;
			this.actionLog.push(...logs);
			const conclusionEntry = logs.find((l) => l.type === "conclusion");
			if (conclusionEntry) this.conclusions.push(conclusionEntry.content);
		}
	}
	/** 第二步：规范校核工程师 */
	async runCode() {
		const schemeIds = this.candidateSchemes.map((s) => s.id);
		if (this.config.mode === "real") {
			const engine = new RealEngine(this.params, this.weights, this.config);
			const prompt = buildAgentPrompt("code", this.params) + `\n\n候选方案：${this.candidateSchemes.map((s) => `${s.name}（${s.id}）`).join("、")}\n
请对每个候选方案逐一调用 check_seismic_requirements 和 check_fire_requirements 工具进行规范校核，给出逐条判定和条文依据。`;
			const result = await engine.run(prompt, "code");
			const allLogs = engine.getActionLog();
			const seisCallLogs = allLogs.filter((log) => log.tool === "check_seismic_requirements" && log.type === "tool_call");
			const fireCallLogs = allLogs.filter((log) => log.tool === "check_fire_requirements" && log.type === "tool_call");
			const seisResults = allLogs.filter((log) => log.tool === "check_seismic_requirements" && log.type === "tool_result");
			const fireResults = allLogs.filter((log) => log.tool === "check_fire_requirements" && log.type === "tool_result");
			const pairByCallId = (calls, results) => {
				const resultByCallId = /* @__PURE__ */ new Map();
				results.forEach((r) => {
					if (r.toolCallId) resultByCallId.set(r.toolCallId, r.result);
				});
				const out = /* @__PURE__ */ new Map();
				calls.forEach((call, idx) => {
					const sysId = call.args?.systemId;
					if (!sysId) return;
					const result = call.toolCallId ? resultByCallId.get(call.toolCallId) : results[idx]?.result;
					if (result !== void 0) out.set(sysId, result);
				});
				return out;
			};
			const seisResultBySysId = pairByCallId(seisCallLogs, seisResults);
			const fireResultBySysId = pairByCallId(fireCallLogs, fireResults);
			schemeIds.forEach((id) => {
				this.codeChecks[id] = {
					seismic: seisResultBySysId.get(id) || null,
					fire: fireResultBySysId.get(id) || null
				};
			});
			this.actionLog.push(...result.actionLog);
			if (result.finalAnswer) this.conclusions.push(`[Code] ${result.finalAnswer.slice(0, 300)}`);
		} else {
			const trace = new TraceEngine(this.params, this.weights);
			const { codeChecks, logs } = trace.runCode(schemeIds);
			this.codeChecks = codeChecks;
			this.actionLog.push(...logs);
			const loopResult = trace.runDebateLoop(schemeIds, this.codeChecks);
			if (loopResult.loops > 0) {
				const newSchemes = loopResult.finalSchemeIds.map((id) => STRUCTURE_SYSTEM_LIBRARY.find((s) => s.id === id)).filter((s) => !!s);
				this.candidateSchemes = newSchemes;
				this.codeChecks = loopResult.finalCodeChecks;
				this.actionLog.push(...loopResult.logs);
				this.correctionMeta = {
					loops: loopResult.loops,
					replacements: loopResult.replacements,
					allPass: loopResult.allPass
				};
			}
			const conclusionEntry = logs.find((l) => l.type === "conclusion");
			if (conclusionEntry) this.conclusions.push(conclusionEntry.content);
		}
	}
	/** 第三步：经济评估工程师 */
	async runEconomist() {
		const schemeIds = this.candidateSchemes.map((s) => s.id);
		if (this.config.mode === "real") {
			const engine = new RealEngine(this.params, this.weights, this.config);
			const prompt = buildAgentPrompt("economist", this.params) + `\n\n候选方案：${this.candidateSchemes.map((s) => `${s.name}（${s.id}）`).join("、")}\n
请对每个候选方案逐一调用 estimate_cost、estimate_schedule、estimate_precast_rate、estimate_carbon、assess_construction_risk 工具进行经济与绿色指标评估。`;
			const result = await engine.run(prompt, "economist");
			const toolNames = [
				"estimate_cost",
				"estimate_schedule",
				"estimate_precast_rate",
				"estimate_carbon",
				"assess_construction_risk"
			];
			const callLogs = engine.getActionLog().filter((log) => log.type === "tool_call" && toolNames.includes(log.tool));
			const resultLogs = engine.getActionLog().filter((log) => log.type === "tool_result" && toolNames.includes(log.tool));
			const resultByCallId = /* @__PURE__ */ new Map();
			resultLogs.forEach((r) => {
				if (r.toolCallId) resultByCallId.set(r.toolCallId, r.result);
			});
			const resultMap = /* @__PURE__ */ new Map();
			callLogs.forEach((call, idx) => {
				const sysId = call.args?.systemId;
				if (sysId && call.tool) {
					const result = call.toolCallId ? resultByCallId.get(call.toolCallId) : resultLogs[idx]?.result;
					if (result !== void 0) resultMap.set(`${sysId}:${call.tool}`, result);
				}
			});
			schemeIds.forEach((id) => {
				this.metrics[id] = {
					cost: resultMap.get(`${id}:estimate_cost`) || null,
					schedule: resultMap.get(`${id}:estimate_schedule`) || null,
					precast: resultMap.get(`${id}:estimate_precast_rate`) || null,
					carbon: resultMap.get(`${id}:estimate_carbon`) || null,
					risk: resultMap.get(`${id}:assess_construction_risk`) || null
				};
			});
			this.actionLog.push(...result.actionLog);
			if (result.finalAnswer) this.conclusions.push(`[Economist] ${result.finalAnswer.slice(0, 300)}`);
		} else {
			const { metrics, logs } = new TraceEngine(this.params, this.weights).runEconomist(schemeIds);
			this.metrics = metrics;
			this.actionLog.push(...logs);
			const conclusionEntry = logs.find((l) => l.type === "conclusion");
			if (conclusionEntry) this.conclusions.push(conclusionEntry.content);
		}
	}
	/** 第四步：总工评审 */
	async runChief() {
		const schemeIds = this.candidateSchemes.map((s) => s.id);
		if (this.config.mode === "real") {
			const engine = new RealEngine(this.params, this.weights, this.config);
			const violationsNow = this.collectViolations();
			const checkStatus = violationsNow.length > 0 ? `\n\n## ⚠️ 校核状态（重要，仲裁必读）\n仍存在未通过规范校核的方案：${violationsNow.map((v) => `${v.schemeName}（${v.schemeId}）：${v.summary}`).join("；")}。请在比选评分中如实反映该风险，并在风险提示中注明"该方案需人工复核后方可深化"。` : "\n\n## ✅ 校核状态\n所有候选方案均已通过（或经迭代修正通过）抗震与防火规范校核。";
			const prompt = buildAgentPrompt("chief", this.params) + `\n\n候选方案：${this.candidateSchemes.map((s) => `${s.name}（${s.id}）`).join("、")}\n\n权重配置：${JSON.stringify(this.weights)}\n` + checkStatus + "\n请调用 compare_schemes 工具进行综合对比评分，调用时必须传入 weights 参数（与上述权重配置一致），然后给出最终结论。\n\n**输出结构必须包含以下章节（按顺序）：**\n1. 综合推荐方案及排序（含综合得分）\n2. 推荐理由（至少3条核心理由）\n3. 各方案优劣势对比\n4. **🤔 总工反思（Reflection）** —— 必须包含以下4小节：\n   - 4.1 反向质疑：主动挑推荐方案的毛病，列出2-3个潜在风险点（「如果我是总工，我会担心什么？」）\n   - 4.2 置信度自评：给出置信度（高/中/低）并说明理由——哪些数据充分、哪些是估算、哪些不确定\n   - 4.3 遗漏检查：自问「有没有遗漏什么重要因素？」——如场地条件、施工可行性、业主特殊需求\n   - 4.4 改进方向：基于反思，给出「如果再做一轮，我会改进什么」\n5. **⚠️ 风险提示** —— 必须包含：\n   - 这个方案最可能出问题的地方是什么\n   - 什么情况下需要重新评估（触发条件）\n   - 后续深化设计时重点关注什么\n6. 下一步优化建议";
			const result = await engine.run(prompt, "chief");
			const compareResult = engine.getActionLog().find((log) => log.tool === "compare_schemes" && log.type === "tool_result")?.result;
			this.actionLog.push(...result.actionLog);
			if (result.finalAnswer) this.conclusions.push(result.finalAnswer);
			this.finalResult = {
				schemes: this.candidateSchemes,
				recommended: {
					schemeId: compareResult?.recommended?.schemeId || schemeIds[0],
					schemeName: compareResult?.recommended?.schemeName || this.candidateSchemes[0]?.name || "",
					overallScore: compareResult?.recommended?.overallScore || 0,
					reason: result.finalAnswer || ""
				},
				ranking: compareResult?.ranking || [],
				codeChecks: this.codeChecks,
				metrics: this.metrics,
				advice: extractAdviceFromMarkdown(result.finalAnswer || ""),
				actionLog: [...this.actionLog],
				conclusions: [...this.conclusions]
			};
		} else {
			const { recommended, ranking, advice, logs } = new TraceEngine(this.params, this.weights).runChief(schemeIds, this.correctionMeta);
			this.actionLog.push(...logs);
			const conclusionEntry = logs.find((l) => l.type === "conclusion");
			if (conclusionEntry) this.conclusions.push(conclusionEntry.content);
			this.finalResult = {
				schemes: this.candidateSchemes,
				recommended,
				ranking,
				codeChecks: this.codeChecks,
				metrics: this.metrics,
				advice,
				actionLog: [...this.actionLog],
				conclusions: [...this.conclusions]
			};
		}
	}
	/** 获取当前中间状态（可选用于流式展示） */
	getState() {
		return {
			params: this.params,
			candidateSchemes: this.candidateSchemes,
			codeChecks: this.codeChecks,
			metrics: this.metrics,
			actionLog: [...this.actionLog],
			conclusions: [...this.conclusions]
		};
	}
};
/**
* 对外统一入口：运行完整 Agent 管线
* 参数变更或重新生成时调用，返回完整管线结果
*/
async function runAgentPipeline(params, weights, config, onProgress, onDegrade) {
	return new AgentPipeline(params, weights, config, onProgress, onDegrade).run();
}
//#endregion
//#region scripts/verify-agentic.ts
var callSeq = 0;
var toolCall = (name, args) => ({
	id: `call_${++callSeq}`,
	type: "function",
	function: {
		name,
		arguments: JSON.stringify(args)
	}
});
var lastUser = (messages) => [...messages].reverse().find((m) => m.role === "user")?.content || "";
var whichAgent = (messages) => {
	const u = lastUser(messages);
	if (u.includes("compare_schemes 工具进行综合对比评分")) return "chief";
	if (u.includes("estimate_cost、estimate_schedule")) return "economist";
	if (u.includes("check_seismic_requirements 和 check_fire_requirements 工具进行规范校核")) return "code";
	if (u.includes("query_structure_systems 工具筛选")) return "architect";
	return "unknown";
};
var extractCandidates = (messages) => {
	const out = [];
	for (const m of messages) if (m.role === "tool") try {
		const parsed = JSON.parse(m.content);
		if (Array.isArray(parsed.candidates)) parsed.candidates.forEach((c) => c?.id && out.push(c.id));
	} catch {}
	if (out.length > 0) return out;
	const u = lastUser(messages);
	const re = /[（(]([a-z][a-z0-9-]*)[）)]/g;
	let m;
	while (m = re.exec(u)) {
		const id = m[1];
		if (![
			"residential",
			"office",
			"school",
			"factory",
			"gymnasium"
		].includes(id)) out.push(id);
	}
	return [...new Set(out)];
};
var PARAMS = {
	buildingType: "residential",
	floors: 30,
	area: 18e3,
	mainSpan: 8.4,
	seismicIntensity: "8",
	soilCategory: "Ⅱ",
	budget: 5e3
};
var architectRedone = false;
var buildMockResponse = (messages) => {
	const agent = whichAgent(messages);
	const candidates = extractCandidates(messages);
	const u = lastUser(messages);
	const hasFeedback = u.includes("上一轮规范校核反馈") || u.includes("校核未通过");
	if (agent === "architect") {
		if (messages.some((m) => m.role === "tool")) return {
			role: "assistant",
			content: architectRedone ? "**方案选型结论（重出）**\n经校核反馈重新选型，建议采用框架-剪力墙结构、剪力墙结构、钢结构作为候选方案。" : "**方案选型结论**\n经筛选，建议采用框架结构、剪力墙结构、钢结构作为候选方案进行比选。"
		};
		if (hasFeedback) {
			architectRedone = true;
			return {
				role: "assistant",
				content: null,
				tool_calls: [toolCall("query_structure_systems", { filters: {
					buildingType: "residential",
					floors: 30,
					seismicIntensity: "8",
					mainSpan: 8.4,
					budget: 5e3,
					preferPass: true
				} })]
			};
		}
		return {
			role: "assistant",
			content: null,
			tool_calls: [toolCall("query_structure_systems", { filters: {
				buildingType: "residential",
				floors: 30,
				seismicIntensity: "8",
				mainSpan: 8.4,
				budget: 5e3
			} })]
		};
	}
	if (agent === "code") {
		if (!messages.some((m) => m.role === "tool")) {
			const calls = [];
			for (const id of candidates) {
				calls.push(toolCall("check_seismic_requirements", {
					systemId: id,
					params: {
						floors: 30,
						seismicIntensity: "8",
						soilCategory: "Ⅱ",
						buildingType: "residential"
					}
				}));
				calls.push(toolCall("check_fire_requirements", {
					systemId: id,
					floors: 30,
					buildingType: "residential"
				}));
			}
			return {
				role: "assistant",
				content: null,
				tool_calls: calls
			};
		}
		return {
			role: "assistant",
			content: "**规范校核结论**\n候选方案已完成抗震与防火校核，个别方案存在适用高度超限，已如实标注。"
		};
	}
	if (agent === "economist") {
		const toolCount = messages.filter((m) => m.role === "tool").length;
		if (toolCount === 0) {
			const calls = [];
			for (const id of candidates) {
				calls.push(toolCall("estimate_cost", {
					systemId: id,
					floors: 30,
					seismicIntensity: "8",
					soilCategory: "Ⅱ",
					mainSpan: 8.4
				}));
				calls.push(toolCall("estimate_schedule", {
					systemId: id,
					area: 18e3,
					floors: 30
				}));
				calls.push(toolCall("estimate_precast_rate", {
					systemId: id,
					floors: 30
				}));
			}
			return {
				role: "assistant",
				content: null,
				tool_calls: calls
			};
		}
		if (toolCount === candidates.length * 3) {
			const calls = [];
			for (const id of candidates) {
				calls.push(toolCall("estimate_carbon", {
					systemId: id,
					floors: 30
				}));
				calls.push(toolCall("assess_construction_risk", {
					systemId: id,
					floors: 30
				}));
			}
			return {
				role: "assistant",
				content: null,
				tool_calls: calls
			};
		}
		return {
			role: "assistant",
			content: "**经济与绿色评估结论**\n框架-剪力墙方案综合经济性与绿色性能最优。"
		};
	}
	if (agent === "chief") {
		if (!messages.some((m) => m.role === "tool")) return {
			role: "assistant",
			content: null,
			tool_calls: [toolCall("compare_schemes", {
				schemeIds: candidates,
				params: PARAMS,
				weights: {
					cost: 25,
					duration: 25,
					safety: 25,
					green: 25
				}
			})]
		};
		return {
			role: "assistant",
			content: `# 综合评审结论
## 1. 综合推荐方案及排序
推荐采用 **框架-剪力墙结构**，综合得分最高。
## 2. 推荐理由
- 抗震性能优越
- 造价适中
- 施工成熟度高
## 3. 各方案优劣势对比
- 剪力墙结构：刚度大但造价偏高
- 钢结构：工期短但防火成本高
## 4. 🤔 总工反思（Reflection）
### 4.1 反向质疑
高层区段需复核层间位移角。
### 4.2 置信度自评
置信度：中高。
### 4.3 遗漏检查
未考虑场地液化影响。
### 4.4 改进方向
下一轮可补充基础方案比选。
## 5. ⚠️ 风险提示
剪力墙布置是关键风险点；烈度提高时需重新评估。
## 6. 下一步优化建议
- 优化剪力墙布置
- 对比基础方案`
		};
	}
	return {
		role: "assistant",
		content: "（未知任务）"
	};
};
function installToolPatches() {
	const queryTool = TOOL_REGISTRY.find((t) => t.name === "query_structure_systems");
	const seisTool = TOOL_REGISTRY.find((t) => t.name === "check_seismic_requirements");
	const fireTool = TOOL_REGISTRY.find((t) => t.name === "check_fire_requirements");
	queryTool.executor;
	const origSeis = seisTool.executor;
	const origFire = fireTool.executor;
	queryTool.executor = ((args) => {
		if (!!args.filters?.preferPass) {
			const ids = [
				"frame-shearwall",
				"shearwall",
				"steel"
			];
			const names = {
				"frame-shearwall": "框架-剪力墙结构",
				shearwall: "剪力墙结构",
				steel: "钢结构"
			};
			return {
				total: 3,
				candidates: ids.map((id) => ({
					id,
					name: names[id],
					description: "",
					applicableScenarios: "",
					advantages: "",
					disadvantages: ""
				}))
			};
		}
		const ids = [
			"frame",
			"shearwall",
			"steel"
		];
		const names = {
			frame: "框架结构",
			shearwall: "剪力墙结构",
			steel: "钢结构"
		};
		return {
			total: 3,
			candidates: ids.map((id) => ({
				id,
				name: names[id],
				description: "",
				applicableScenarios: "",
				advantages: "",
				disadvantages: ""
			}))
		};
	});
	seisTool.executor = ((args) => {
		const base = origSeis(args);
		if (args.systemId === "frame") return {
			...base,
			systemId: "frame",
			summary: "框架结构最大适用高度 50m，本工程 96m 超出限值",
			passCount: 0,
			warningCount: 0,
			failCount: 1,
			checks: [{
				name: "最大适用高度",
				status: "fail",
				value: "96",
				requirement: "≤50",
				description: "框架结构最大适用高度超限",
				basis: "GB 55002-2021 表5.1.2",
				formula: "H=30×3.2=96m > 50m",
				input: {
					floors: 30,
					height: 96
				},
				clauseText: "框架结构最大适用高度为50m",
				reason: "适用高度超限",
				source: "GB 55002-2021"
			}]
		};
		const n = (base?.checks?.length ?? 1) || 1;
		return {
			...base,
			systemId: args.systemId,
			summary: "抗震校核全部通过",
			passCount: n,
			warningCount: 0,
			failCount: 0,
			checks: (base?.checks ?? []).map((c) => ({
				...c,
				status: "pass"
			}))
		};
	});
	fireTool.executor = ((args) => {
		const base = origFire(args);
		const n = (base?.checks?.length ?? 1) || 1;
		return {
			...base,
			systemId: args.systemId,
			summary: "防火校核全部通过",
			passCount: n,
			warningCount: 0,
			failCount: 0,
			checks: (base?.checks ?? []).map((c) => ({
				...c,
				status: "pass"
			}))
		};
	});
}
async function scenarioRecheck() {
	callSeq = 0;
	architectRedone = false;
	installToolPatches();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (_input, init) => {
		const message = buildMockResponse(JSON.parse(String(init?.body)).messages);
		return new Response(JSON.stringify({
			choices: [{ message }],
			usage: { total_tokens: 0 }
		}), {
			status: 200,
			headers: { "Content-Type": "application/json" }
		});
	});
	const progress = [];
	const result = await runAgentPipeline(PARAMS, void 0, {
		mode: "real",
		endpoint: "https://api.deepseek.com/v1",
		apiKey: "sk-mock-not-real",
		model: "deepseek-chat",
		maxSteps: 20
	}, (_l, agentIndex) => progress.push(agentIndex));
	globalThis.fetch = originalFetch;
	const architectConclusions = result.conclusions.filter((c) => c.startsWith("[Architect]")).length;
	const finalIds = result.schemes.map((s) => s.id);
	const frameCheck = result.codeChecks["frame"];
	const checks = [
		[
			"回退触发：Architect 被重出（≥2 条结论）",
			architectConclusions >= 2,
			`实际 ${architectConclusions}`
		],
		[
			"第一轮违规被真实记录（codeChecks.frame 有 fail）",
			!!frameCheck?.seismic && (frameCheck.seismic.failCount ?? 0) > 0,
			`frame.seismic=${JSON.stringify(frameCheck?.seismic?.summary)}`
		],
		[
			"最终方案不含违规的 frame",
			!finalIds.includes("frame"),
			`最终 ${finalIds.join(",")}`
		],
		[
			"重出方案生效：含 frame-shearwall",
			finalIds.includes("frame-shearwall"),
			`最终 ${finalIds.join(",")}`
		],
		[
			"最终 codeChecks 不再校核 frame",
			!result.codeChecks["frame"] || !finalIds.includes("frame"),
			`keys=${Object.keys(result.codeChecks).join(",")}`
		],
		[
			"Chief 完整仲裁（进度走完 4 阶段）",
			progress.length >= 4,
			`进度 ${JSON.stringify(progress)}`
		],
		[
			"结果完整性：ranking≥2 且 recommended 有效",
			result.ranking.length >= 2 && !!result.recommended.schemeId,
			`ranking ${result.ranking.length}, rec ${result.recommended.schemeId}`
		],
		[
			"无降级标记（真实模式正常完成）",
			!result.degraded,
			`degraded=${JSON.stringify(result.degraded)}`
		]
	];
	console.log("===== 场景 1：校核回退闭环 =====\n");
	let pass = 0;
	for (const [name, ok, detail] of checks) {
		console.log(`${ok ? "✅" : "❌"} ${name}  [${detail}]`);
		if (ok) pass++;
	}
	return {
		ok: pass === checks.length,
		pass,
		total: checks.length
	};
}
async function scenarioDegrade() {
	callSeq = 0;
	let degradeReason = "";
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls++;
		throw new Error("LLM 请求失败 (503): service unavailable");
	});
	const result = await runAgentPipeline(PARAMS, void 0, {
		mode: "real",
		endpoint: "https://api.deepseek.com/v1",
		apiKey: "sk-mock-not-real",
		model: "deepseek-chat",
		maxSteps: 20
	}, void 0, (reason) => {
		degradeReason = reason;
	});
	const checks = [
		[
			"真实请求确实失败",
			fetchCalls >= 1,
			`fetch 调用 ${fetchCalls} 次`
		],
		[
			"降级回调触发（onDegrade）",
			degradeReason.includes("503"),
			`reason=${degradeReason.slice(0, 60)}`
		],
		[
			"结果带 degraded 标记",
			result.degraded?.from === "real" && !!result.degraded.reason,
			`degraded=${JSON.stringify(result.degraded)}`
		],
		[
			"降级后仍产出完整结果（schemes/ranking）",
			result.schemes.length >= 2 && result.ranking.length >= 1,
			`schemes ${result.schemes.length}, ranking ${result.ranking.length}`
		],
		[
			"recommended 有效",
			!!result.recommended.schemeId && result.recommended.overallScore > 0,
			`rec ${result.recommended.schemeId} score ${result.recommended.overallScore}`
		],
		[
			"结论完整（四 Agent）",
			result.conclusions.length >= 4,
			`实际 ${result.conclusions.length}`
		]
	];
	console.log("\n===== 场景 2：崩溃自动降级 =====\n");
	let pass = 0;
	for (const [name, ok, detail] of checks) {
		console.log(`${ok ? "✅" : "❌"} ${name}  [${detail}]`);
		if (ok) pass++;
	}
	return {
		ok: pass === checks.length,
		pass,
		total: checks.length
	};
}
scopedStorage.setItem("agent_engine_config", JSON.stringify({
	endpoint: "https://api.deepseek.com/v1",
	apiKey: "sk-mock-not-real",
	model: "deepseek-chat"
}));
var r1 = await scenarioRecheck();
var r2 = await scenarioDegrade();
console.log(`\n---- 汇总：场景1 ${r1.pass}/${r1.total} · 场景2 ${r2.pass}/${r2.total} ----`);
if (r1.ok && r2.ok) {
	console.log("🎯 真实模式升级专项验证全部通过：回退闭环生效 + 崩溃降级保命机制生效");
	process.exit(0);
} else {
	console.log("⚠️ 存在失败项，见上方 ❌");
	process.exit(1);
}
//#endregion
export {};
