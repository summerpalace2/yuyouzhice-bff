/**
 * attractions-data.mjs
 *
 * 核心职责：提供重庆高价值目的地的结构化元数据、高德 POI 检索配置、详情展示与动态替换特征库。
 *
 * 目录中的新增目的地优先使用高德运行时 POI 坐标；未完成逐项核验的门票、开放、坡度与无障碍信息明确标记为待核验。
 */

const EXPANDED_ATTRACTION_DESCRIPTORS = [
  {
    id: 'cq-shancheng-budao', name: '山城步道', district: '渝中区', category: '历史人文',
    tags: ['山城步道', '老城记忆', '步行', '摄影'], audienceTags: ['摄影', '情侣'], icon: '道', tone: 'gold',
    summary: '沿渝中山地街巷串联老城生活与城市高差的步行目的地。',
    fit: '适合希望观察老重庆街巷、接受分段步行并控制游览长度的旅行者。',
    amapKeywords: ['山城步道', '山城巷'], sourceIds: ['src-gov-yuzhong-002']
  },
  {
    id: 'cq-baixangju', name: '白象居', district: '渝中区', category: '城市',
    tags: ['居民楼', '城市摄影', '老城', '高差'], audienceTags: ['摄影', '情侣'], icon: '居', tone: 'teal',
    summary: '保留居民生活痕迹与山城高差视角的城市观察目的地。',
    fit: '适合摄影和城市空间观察；应尊重居民生活并按现场通行提示参观。',
    amapKeywords: ['白象居'], sourceIds: ['src-news-cqnews-012', 'src-gov-yuzhong-002']
  },
  {
    id: 'cq-chaotianmen', name: '朝天门广场', district: '渝中区', category: '夜景',
    tags: ['两江交汇', '城市地标', '江岸', '夜景'], audienceTags: ['摄影', '情侣', '老人友好'], icon: '门', tone: 'blue',
    summary: '观察两江交汇与渝中半岛城市界面的开放式滨江地标。',
    fit: '适合与来福士、两江游或江岸节点组合；具体客流和活动以现场为准。',
    amapKeywords: ['朝天门广场', '朝天门'], sourceIds: ['src-gov-yuzhong-002']
  },
  {
    id: 'cq-liangjiang-you', name: '两江游', district: '渝中区/南岸区/江北区', category: '夜景',
    tags: ['两江夜景', '游船', '江岸摄影', '天气敏感'], audienceTags: ['情侣', '摄影'], icon: '船', tone: 'purple',
    summary: '以江上视角观察重庆两江四岸夜景的动态体验项目。',
    fit: '适合夜景与情侣行程，但应把天气、班次和临时停运作为出发前核验项。',
    amapKeywords: ['重庆两江游', '两江游'], sourceIds: ['src-gov-yuzhong-002', 'src-authorized-bendibao-010']
  },
  {
    id: 'cq-chongqing-zoo', name: '重庆动物园', district: '九龙坡区', category: '亲子',
    tags: ['动物', '亲子', '户外', '科普'], audienceTags: ['亲子', '老人友好'], icon: '熊', tone: 'green',
    summary: '面向亲子与动物科普需求的城市公共动物园目的地。',
    fit: '适合亲子和科普行程；园区步行距离、遮阴和当日开放安排应提前核验。',
    amapKeywords: ['重庆动物园'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-yuanboyuan', name: '重庆园博园', district: '渝北区/两江新区', category: '自然风景',
    tags: ['园林', '亲子', '户外', '摄影'], audienceTags: ['亲子', '摄影', '老人友好'], icon: '园', tone: 'green',
    summary: '以园林景观、城市生态和户外漫游为主题的大型公园目的地。',
    fit: '适合亲子、摄影和慢游；园区尺度较大，建议先核验接驳与分区路线。',
    amapKeywords: ['重庆园博园', '园博园'], sourceIds: ['src-gov-cq-parks-018', 'src-gov-cq-a-level-014']
  },
  {
    id: 'cq-xiannyshan', name: '仙女山国家森林公园', district: '武隆区', category: '自然风景',
    tags: ['森林', '高原草场', '亲子', '避暑'], audienceTags: ['亲子', '摄影'], icon: '林', tone: 'green',
    summary: '武隆喀斯特区域内以森林与开阔户外景观为主题的自然目的地。',
    fit: '适合自然风景、摄影和避暑安排；季节、天气、接驳与步行强度需出发前核验。',
    amapKeywords: ['仙女山国家森林公园', '仙女山'], sourceIds: ['src-venue-wulong-005', 'src-gov-cq-a-level-014']
  },
  {
    id: 'cq-jinfoshan', name: '金佛山', district: '南川区', category: '自然风景',
    tags: ['喀斯特', '山岳', '森林', '四季景观'], audienceTags: ['摄影', '情侣'], icon: '佛', tone: 'green',
    summary: '以喀斯特山岳、森林和季节性自然景观为核心的区县目的地。',
    fit: '适合自然风景深度游；索道、接驳、天气与山地步行条件必须按当日官方信息确认。',
    amapKeywords: ['金佛山', '金佛山景区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-ziran-museum', name: '重庆自然博物馆', district: '北碚区', category: '亲子',
    tags: ['自然博物馆', '恐龙', '室内', '科普'], audienceTags: ['亲子', '老人友好'], icon: '化', tone: 'blue',
    summary: '以自然史、生命演化和科学普及为主题的室内亲子目的地。',
    fit: '适合雨天、亲子和科普行程；开放时段与预约规则应以馆方公告为准。',
    amapKeywords: ['重庆自然博物馆'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-kejiguan', name: '重庆科技馆', district: '江北区', category: '亲子',
    tags: ['科技', '互动展陈', '室内', '亲子'], audienceTags: ['亲子', '老人友好'], icon: '科', tone: 'blue',
    summary: '面向家庭与青少年科学体验的江北嘴室内文化场馆。',
    fit: '适合亲子、雨天和互动科普；具体展项、开放时段与预约要求需现场核验。',
    amapKeywords: ['重庆科技馆'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-meishuguan', name: '重庆美术馆', district: '渝中区', category: '历史人文',
    tags: ['美术馆', '展览', '室内', '城市文化'], audienceTags: ['情侣', '老人友好', '摄影'], icon: '艺', tone: 'purple',
    summary: '位于城市核心区、以当代展览与视觉文化为主题的室内场馆。',
    fit: '适合雨天、情侣和文化慢游；展览档期与入馆规则应以馆方公告为准。',
    amapKeywords: ['重庆美术馆'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-renmin-dalitang', name: '重庆人民大礼堂', district: '渝中区', category: '历史人文',
    tags: ['城市地标', '建筑', '广场', '摄影'], audienceTags: ['老人友好', '摄影'], icon: '堂', tone: 'gold',
    summary: '以标志性建筑、人民广场和城市历史记忆为核心的文化地标。',
    fit: '适合与三峡博物馆安排为同片区人文行程；内部参观规则需以管理处为准。',
    amapKeywords: ['重庆人民大礼堂', '人民大礼堂'], sourceIds: ['src-venue-dalitang-007']
  },
  {
    id: 'cq-nanbinlu', name: '南滨路', district: '南岸区', category: '夜景',
    tags: ['滨江', '夜景', '散步', '城市摄影'], audienceTags: ['情侣', '摄影', '老人友好'], icon: '滨', tone: 'teal',
    summary: '沿江观察渝中半岛与两江夜色的城市滨水公共空间。',
    fit: '适合把滨江散步、餐饮和远眺组合为低密度夜间行程；具体灯光与管制需核验。',
    amapKeywords: ['南滨路', '南滨路景观带'], sourceIds: ['src-gov-cq-night-015']
  },
  {
    id: 'cq-happy-valley', name: '重庆欢乐谷', district: '两江新区', category: '亲子',
    tags: ['主题乐园', '亲子', '游乐设施', '户外'], audienceTags: ['亲子'], icon: '乐', tone: 'red',
    summary: '以主题游乐设施和家庭娱乐为核心的综合型游乐目的地。',
    fit: '适合亲子与朋友同行；项目开放、身高限制、排队和夜场安排需官方核验。',
    amapKeywords: ['重庆欢乐谷'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-rff-square', name: '重庆来福士广场（朝天门）', district: '渝中区', category: '城市',
    tags: ['城市综合体', '朝天门', '江景', '室内'], audienceTags: ['老人友好', '情侣'], icon: '帆', tone: 'blue',
    summary: '朝天门片区的城市综合体与江岸观景组合目的地。',
    fit: '适合雨天、购物餐饮与朝天门江景组合；观景项目和开放时间需逐项核验。',
    amapKeywords: ['重庆来福士广场', '来福士广场'], sourceIds: ['src-gov-yuzhong-002', 'src-gov-cq-night-015']
  },
  {
    id: 'cq-longmenhao', name: '龙门浩老街', district: '南岸区', category: '历史人文',
    tags: ['开埠文化', '老街', '江景', '摄影'], audienceTags: ['情侣', '摄影'], icon: '浩', tone: 'gold',
    summary: '以开埠历史街巷、山城层次与滨江视野为主题的传统风貌目的地。',
    fit: '适合历史街区和摄影慢游；坡度、台阶、开放店铺与夜间灯光需现场核验。',
    amapKeywords: ['龙门浩老街'], sourceIds: ['src-gov-cq-night-015']
  },
  {
    id: 'cq-hongyan-memorial', name: '红岩革命纪念馆', district: '渝中区', category: '历史人文',
    tags: ['红色旅游', '纪念馆', '室内', '研学'], audienceTags: ['亲子', '老人友好'], icon: '红', tone: 'red',
    summary: '以红岩历史与革命文物展陈为主题的城市红色文化场馆。',
    fit: '适合研学与历史教育；开放、预约、安检和当天展陈安排需馆方核验。',
    amapKeywords: ['红岩革命纪念馆'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-democratic-history', name: '中国民主党派历史陈列馆', district: '渝中区', category: '历史人文',
    tags: ['近现代史', '陈列馆', '室内', '城市文化'], audienceTags: ['老人友好', '亲子'], icon: '史', tone: 'blue',
    summary: '以中国民主党派历史与重庆近现代城市记忆为主题的陈列馆。',
    fit: '适合室内人文与历史学习；开放时段和入馆方式需以官方公告为准。',
    amapKeywords: ['中国民主党派历史陈列馆'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-war-relics-museum', name: '重庆抗战遗址博物馆', district: '南岸区', category: '历史人文',
    tags: ['抗战遗址', '博物馆', '近现代史', '山地'], audienceTags: ['亲子', '老人友好'], icon: '战', tone: 'red',
    summary: '以重庆抗战时期遗址、建筑与城市记忆为主题的历史文化目的地。',
    fit: '适合深度人文与研学；遗址间步行、坡度和开放范围需逐项核验。',
    amapKeywords: ['重庆抗战遗址博物馆'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-industrial-culture-expo', name: '重庆工业文化博览园', district: '大渡口区', category: '历史人文',
    tags: ['工业遗产', '博物馆', '亲子', '摄影'], audienceTags: ['亲子', '摄影'], icon: '工', tone: 'teal',
    summary: '以重庆工业遗产、城市发展与工业文化展示为主题的园区型目的地。',
    fit: '适合工业文化、亲子科普和摄影；展馆开放与园区步行距离需核验。',
    amapKeywords: ['重庆工业文化博览园'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-jianchuan-museum', name: '重庆建川博物馆', district: '大渡口区', category: '历史人文',
    tags: ['博物馆聚落', '抗战记忆', '工业遗产', '室内'], audienceTags: ['亲子', '老人友好'], icon: '川', tone: 'blue',
    summary: '以近现代历史、工业遗产与专题收藏为主题的博物馆聚落。',
    fit: '适合历史深度游；馆群数量、展馆开放和预约方式需以官方渠道核验。',
    amapKeywords: ['重庆建川博物馆'], sourceIds: ['src-gov-cq-museum-017']
  },
  {
    id: 'cq-huayan', name: '华岩旅游区', district: '九龙坡区', category: '历史人文',
    tags: ['寺院', '园林', '人文', '近郊'], audienceTags: ['老人友好', '摄影'], icon: '岩', tone: 'gold',
    summary: '以华岩寺院、园林环境和城市近郊人文体验为主题的目的地。',
    fit: '适合安静人文与园林慢游；宗教场所礼仪、坡度和开放安排需现场核验。',
    amapKeywords: ['华岩旅游区', '华岩寺'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-nanshan-botanical', name: '南山植物园', district: '南岸区', category: '自然风景',
    tags: ['植物园', '花卉', '摄影', '自然'], audienceTags: ['亲子', '摄影', '情侣'], icon: '植', tone: 'green',
    summary: '以植物收集、季节花卉和山地园林景观为主题的城市自然目的地。',
    fit: '适合摄影、亲子和慢游；花期、园区接驳、坡度与开放安排需核验。',
    amapKeywords: ['南山植物园', '重庆南山植物园'], sourceIds: ['src-gov-cq-parks-018']
  },
  {
    id: 'cq-beiquan', name: '北温泉风景区', district: '北碚区', category: '温泉',
    tags: ['温泉', '山水', '近郊', '休闲'], audienceTags: ['老人友好', '情侣'], icon: '北', tone: 'teal',
    summary: '以北碚山水环境与温泉休闲为主题的近郊目的地。',
    fit: '适合恢复型慢游；温泉营业、票价、泡池和无障碍设施需以运营方为准。',
    amapKeywords: ['北温泉风景区', '北温泉'], sourceIds: ['src-gov-cq-hot-spring-016']
  },
  {
    id: 'cq-dongquan', name: '东温泉风景区', district: '巴南区', category: '温泉',
    tags: ['温泉', '近郊', '休闲', '自然'], audienceTags: ['老人友好', '情侣'], icon: '东', tone: 'teal',
    summary: '以巴南近郊温泉与自然休闲为主题的区县目的地。',
    fit: '适合温泉度假和低密度休闲；开放、交通接驳及设施差异需逐家核验。',
    amapKeywords: ['东温泉风景区', '重庆东温泉'], sourceIds: ['src-gov-cq-hot-spring-016']
  },
  {
    id: 'cq-tongjing', name: '统景温泉风景区', district: '渝北区', category: '温泉',
    tags: ['温泉', '峡谷', '近郊', '休闲'], audienceTags: ['老人友好', '情侣'], icon: '统', tone: 'teal',
    summary: '以渝北近郊温泉与峡谷自然环境为主题的休闲目的地。',
    fit: '适合恢复型度假；温泉项目、接驳、坡度和当日营业安排需官方核验。',
    amapKeywords: ['统景温泉风景区', '统景温泉'], sourceIds: ['src-gov-cq-hot-spring-016']
  },
  {
    id: 'cq-hailan-yuntian', name: '海兰云天温泉度假区', district: '九龙坡区', category: '温泉',
    tags: ['温泉度假', '休闲', '近郊', '亲子'], audienceTags: ['老人友好', '情侣'], icon: '海', tone: 'teal',
    summary: '以温泉、度假和近郊休闲为主题的综合型温泉目的地。',
    fit: '适合安排为半日或一日恢复节点；票价、泡池、住宿和接驳需运营方核验。',
    amapKeywords: ['海兰云天温泉度假区', '海兰云天温泉'], sourceIds: ['src-gov-cq-hot-spring-016']
  },
  {
    id: 'cq-beidi-yiyuan', name: '贝迪颐园温泉度假区', district: '九龙坡区', category: '温泉',
    tags: ['温泉度假', '休闲', '康养', '近郊'], audienceTags: ['老人友好', '情侣'], icon: '颐', tone: 'teal',
    summary: '以温泉、康养和度假休闲为主题的近郊目的地。',
    fit: '适合低体力放松行程；营业、费用、健康提示和无障碍条件需以官方为准。',
    amapKeywords: ['贝迪颐园温泉度假区', '贝迪颐园'], sourceIds: ['src-gov-cq-hot-spring-016']
  },
  {
    id: 'cq-hanhai-ocean', name: '汉海海洋公园', district: '巴南区', category: '亲子',
    tags: ['海洋馆', '亲子', '室内', '科普'], audienceTags: ['亲子', '老人友好'], icon: '海', tone: 'blue',
    summary: '以海洋生物展示、科普和室内家庭体验为主题的亲子目的地。',
    fit: '适合雨天亲子行程；演出、票价、开放与排队安排需官方核验。',
    amapKeywords: ['汉海海洋公园', '重庆汉海海洋公园'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-lehe-ledu', name: '乐和乐都景区', district: '永川区', category: '亲子',
    tags: ['野生动物', '主题乐园', '亲子', '区县目的地'], audienceTags: ['亲子'], icon: '乐', tone: 'green',
    summary: '以野生动物展示和主题游乐为核心的区县综合型亲子目的地。',
    fit: '适合安排为一日或过夜亲子目的地；园区接驳、项目开放与票务需核验。',
    amapKeywords: ['乐和乐都景区', '重庆乐和乐都'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-jinyunshan', name: '缙云山景区', district: '北碚区', category: '自然风景',
    tags: ['山岳', '森林', '避暑', '摄影'], audienceTags: ['摄影', '情侣'], icon: '缙', tone: 'green',
    summary: '以北碚山地森林、自然观察和避暑为主题的近郊目的地。',
    fit: '适合自然慢游和摄影；山路、天气、接驳与体力要求需按具体线路核验。',
    amapKeywords: ['缙云山景区', '缙云山国家级自然保护区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-jindaoxia', name: '北碚金刀峡景区', district: '北碚区', category: '自然风景',
    tags: ['峡谷', '溪流', '徒步', '摄影'], audienceTags: ['摄影'], icon: '峡', tone: 'green',
    summary: '以峡谷、溪流和山地自然景观为主题的户外区县目的地。',
    fit: '适合户外与摄影；阶梯、涉水、雨季安全、接驳和体力强度必须提前核验。',
    amapKeywords: ['北碚金刀峡景区', '金刀峡'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-heishangu', name: '万盛黑山谷', district: '綦江区', category: '自然风景',
    tags: ['峡谷', '森林', '溪流', '避暑'], audienceTags: ['摄影'], icon: '黑', tone: 'green',
    summary: '以森林峡谷和溪流生态景观为主题的万盛区县自然目的地。',
    fit: '适合自然风景深度游；接驳、步道长度、天气和雨季安全需官方核验。',
    amapKeywords: ['万盛黑山谷', '黑山谷景区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-simian-mountain', name: '江津四面山', district: '江津区', category: '自然风景',
    tags: ['山水', '瀑布', '森林', '区县目的地'], audienceTags: ['摄影', '情侣'], icon: '四', tone: 'green',
    summary: '以森林、瀑布和山水景观为主题的江津区县目的地。',
    fit: '适合多日自然行程；景区跨度、接驳、步行强度和天气需按线路核验。',
    amapKeywords: ['江津四面山', '四面山景区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-wushan-small-gorges', name: '巫山小三峡—小小三峡', district: '巫山县', category: '自然风景',
    tags: ['峡谷', '游船', '山水', '区县目的地'], audienceTags: ['摄影', '情侣'], icon: '峡', tone: 'blue',
    summary: '以峡谷山水和江上游览为主题的巫山区县目的地。',
    fit: '适合山水摄影；船班、天气、水位与临时运营安排需出发前官方核验。',
    amapKeywords: ['巫山小三峡', '小小三峡'], sourceIds: ['src-gov-cq-a-level-014', 'src-authorized-bendibao-010']
  },
  {
    id: 'cq-yunyang-longgang', name: '云阳龙缸', district: '云阳县', category: '自然风景',
    tags: ['地质奇观', '峡谷', '玻璃景观', '摄影'], audienceTags: ['摄影', '情侣'], icon: '缸', tone: 'green',
    summary: '以喀斯特地貌、峡谷和高位观景为主题的云阳区县目的地。',
    fit: '适合自然摄影；高处风力、玻璃景观、接驳和步行安全需以官方提示为准。',
    amapKeywords: ['云阳龙缸', '云阳龙缸国家地质公园'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-baidi-qutang', name: '奉节白帝城·瞿塘峡', district: '奉节县', category: '历史人文',
    tags: ['三峡文化', '古迹', '山水', '诗歌'], audienceTags: ['摄影', '情侣'], icon: '白', tone: 'gold',
    summary: '以三峡历史、诗歌文化和瞿塘峡山水为主题的奉节目的地。',
    fit: '适合历史与山水组合；船班、景区接驳、台阶和开放安排需逐项核验。',
    amapKeywords: ['奉节白帝城', '瞿塘峡', '白帝城景区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-wulingshan-rift', name: '涪陵武陵山大裂谷', district: '涪陵区', category: '自然风景',
    tags: ['裂谷', '峡谷', '地质景观', '摄影'], audienceTags: ['摄影'], icon: '裂', tone: 'green',
    summary: '以裂谷、峡谷和地质景观为主题的涪陵区县自然目的地。',
    fit: '适合自然摄影；接驳、垂直交通、步道坡度和天气风险需官方核验。',
    amapKeywords: ['涪陵武陵山大裂谷', '武陵山大裂谷'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-aihe', name: '彭水阿依河', district: '彭水苗族土家族自治县', category: '自然风景',
    tags: ['峡谷', '漂流', '民族文化', '户外'], audienceTags: ['情侣', '摄影'], icon: '河', tone: 'blue',
    summary: '以峡谷河流、户外活动和民族地域文化为主题的彭水目的地。',
    fit: '适合户外与山水行程；水上项目、天气、安全和接驳需出发前官方核验。',
    amapKeywords: ['彭水阿依河', '阿依河景区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-zhuoshui', name: '黔江濯水', district: '黔江区', category: '历史人文',
    tags: ['古镇', '廊桥', '民族文化', '摄影'], audienceTags: ['摄影', '情侣'], icon: '濯', tone: 'gold',
    summary: '以古镇街巷、廊桥和民族地域文化为主题的黔江目的地。',
    fit: '适合古镇摄影与慢游；开放店铺、夜景活动和交通接驳需核验。',
    amapKeywords: ['黔江濯水古镇', '濯水古镇'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-taohuayuan', name: '酉阳桃花源', district: '酉阳土家族苗族自治县', category: '自然风景',
    tags: ['洞穴', '山水', '桃花源文化', '区县目的地'], audienceTags: ['亲子', '摄影'], icon: '源', tone: 'green',
    summary: '以桃花源文化叙事、山水与洞穴景观为主题的酉阳目的地。',
    fit: '适合文化与自然组合；洞穴路线、接驳、季节活动和步行强度需核验。',
    amapKeywords: ['酉阳桃花源', '桃花源景区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-gongtan', name: '酉阳龚滩古镇', district: '酉阳土家族苗族自治县', category: '历史人文',
    tags: ['古镇', '乌江', '吊脚楼', '摄影'], audienceTags: ['摄影', '情侣'], icon: '龚', tone: 'gold',
    summary: '以乌江沿岸古镇、吊脚楼和地域文化为主题的酉阳目的地。',
    fit: '适合古镇和江景摄影；台阶、临江安全、船班与住宿安排需核验。',
    amapKeywords: ['酉阳龚滩古镇', '龚滩古镇'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-diaoyucheng', name: '合川钓鱼城', district: '合川区', category: '历史人文',
    tags: ['古战场', '城址', '历史', '山地'], audienceTags: ['摄影'], icon: '钓', tone: 'red',
    summary: '以宋元战争遗址、古城址和山地历史景观为主题的合川目的地。',
    fit: '适合历史深度游；遗址范围、坡度、遮阴与交通接驳需现场核验。',
    amapKeywords: ['合川钓鱼城', '钓鱼城景区'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-anjugu', name: '铜梁安居古城', district: '铜梁区', category: '历史人文',
    tags: ['古城', '传统街巷', '民俗', '摄影'], audienceTags: ['摄影', '情侣'], icon: '安', tone: 'gold',
    summary: '以传统街巷、古城格局和地方民俗为主题的铜梁目的地。',
    fit: '适合古城慢游；节庆活动、开放商户、停车与步行范围需核验。',
    amapKeywords: ['铜梁安居古城', '安居古城'], sourceIds: ['src-gov-cq-a-level-014']
  },
  {
    id: 'cq-liujia-matou', name: '江北鎏嘉码头', district: '江北区', category: '夜景',
    tags: ['滨江', '餐饮', '夜景', '城市生活'], audienceTags: ['情侣', '摄影', '老人友好'], icon: '鎏', tone: 'purple',
    summary: '以江北滨江餐饮、城市夜景和休闲消费为主题的城市目的地。',
    fit: '适合夜间餐饮与滨江散步组合；商户营业和临江步行条件需现场核验。',
    amapKeywords: ['江北鎏嘉码头', '鎏嘉码头'], sourceIds: ['src-gov-cq-night-015']
  },
  {
    id: 'cq-hongensi-park', name: '鸿恩寺公园', district: '江北区', category: '自然风景',
    tags: ['城市公园', '森林', '观景', '亲子'], audienceTags: ['老人友好', '亲子', '摄影'], icon: '鸿', tone: 'green',
    summary: '以城市森林、公园步行和高处城市视野为主题的江北公共空间。',
    fit: '适合城市休闲和摄影；坡度、夜间照明、开放时间与休息点需核验。',
    amapKeywords: ['鸿恩寺公园'], sourceIds: ['src-gov-cq-parks-018']
  }
];

const EXPANDED_ATTRACTIONS = Object.freeze(EXPANDED_ATTRACTION_DESCRIPTORS.map((item) => ({
  id: item.id,
  name: item.name,
  displayName: item.name,
  district: item.district,
  category: item.category,
  tags: item.tags,
  audienceTags: item.audienceTags || [],
  icon: item.icon,
  tone: item.tone,
  location: '',
  summary: item.summary,
  walk: '步行强度、坡度与无障碍设施：待官方或运行时核验',
  duration: '建议停留：待官方开放安排与现场动线核验',
  indoor: item.indoor === true,
  walkDifficulty: '待核验',
  ticket: '门票、预约与开放时间：以官方渠道为准',
  bestTime: '推荐时段：以官方开放安排与天气为准',
  amapQuery: {
    keywords: item.amapKeywords[0],
    alternatives: item.amapKeywords.slice(1),
    matches: item.amapKeywords
  },
  intro: item.summary,
  fit: item.fit,
  catalogStatus: 'needs_runtime_or_official_detail_check',
  sourceIds: item.sourceIds || []
})));

export const ATTRACTIONS_DATA = Object.freeze([
  {
    id: 'cq-hongyadong',
    name: '洪崖洞',
    displayName: '洪崖洞',
    district: '渝中区',
    category: '夜景',
    tags: ['夜景', '临江', '城市地标', '拍照'],
    icon: '灯',
    tone: 'gold',
    location: '106.582967,29.563009',
    summary: '山城吊脚楼依山而建，金碧辉煌的夜色与两江交汇交相辉映。',
    walk: '步行约 12 分钟',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '中',
    ticket: '免费开放 · 无需预约',
    bestTime: '19:30 - 22:00',
    amapQuery: { keywords: '洪崖洞', matches: ['洪崖洞', '洪崖洞民俗风貌区', '洪崖洞景区'] },
    intro: '洪崖洞民俗风貌区以巴渝传统建筑吊脚楼为主体，依山就势沿崖而建，高低落差达11层。入夜后华灯初上，宛如现实版《千与千寻》，是重庆山城夜景的经典名片。',
    fit: '适合喜欢夜景、摄影打卡、希望集中感受重庆山城立体辨识度的旅行者。'
  },
  {
    id: 'cq-jiefangbei',
    name: '解放碑步行街',
    displayName: '解放碑步行街',
    district: '渝中区',
    category: '城市',
    tags: ['城市', '街区', '少走路', '地标', '美食'],
    icon: '碑',
    tone: 'red',
    location: '106.577054,29.557161',
    summary: '重庆最核心的城市原点与平街商圈，地势平缓适合悠闲漫步。',
    walk: '少走路 · 平街步行',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '免费开放 · 全天',
    bestTime: '全天可游览',
    amapQuery: { keywords: '解放碑步行街', alternatives: ['解放碑', '人民解放纪念碑'], matches: ['解放碑', '解放碑步行街', '人民解放纪念碑', '解放碑商圈', '重庆解放碑'] },
    intro: '解放碑是全中国唯一一座纪念中华民族抗日战争胜利的纪念碑，也是重庆母城中心。步行街平坦无陡坡，周边汇聚八一路好吃街、各大老字号与现代商业综合体。',
    fit: '适合作为抵渝第一站认知城市、带父母长辈轻松漫步以及品尝地道小吃的旅行者。'
  },
  {
    id: 'cq-museum',
    name: '重庆中国三峡博物馆',
    displayName: '重庆中国三峡博物馆',
    district: '渝中区',
    category: '人文',
    tags: ['室内', '人文', '历史', '少走路', '长辈友好'],
    icon: '馆',
    tone: 'blue',
    location: '106.549882,29.558371',
    summary: '馆藏巴蜀青铜器与三峡变迁史诗，全馆无障碍平滑观展。',
    walk: '公交优先 · 无障碍平滑',
    duration: '约 120 分钟',
    indoor: true,
    walkDifficulty: '低',
    ticket: '免费开放 · 建议刷身份证',
    bestTime: '09:00 - 17:00 (周一闭馆)',
    amapQuery: { keywords: '重庆中国三峡博物馆', matches: ['重庆中国三峡博物馆', '三峡博物馆'] },
    intro: '国家一级博物馆，馆内系统展示了壮丽三峡的自然地貌与人文迁徙历史、巴渝远古文明及抗战岁月。全馆配备完善的直梯与坡道，冬暖夏凉，是雨天或避暑的极佳室内场馆。',
    fit: '适合热爱历史人文、带父母小孩同行、或遇到雨天需要舒适室内场馆的旅行者。'
  },
  {
    id: 'cq-liziba',
    name: '李子坝轻轨站',
    displayName: '李子坝轻轨站',
    district: '渝中区',
    category: '城市',
    tags: ['8D魔幻', '交通', '拍照', '短停留'],
    icon: '轨',
    tone: 'green',
    location: '106.539328,29.553896',
    summary: '单轨列车穿楼而过的魔幻奇观，地面观景平台平坦视野极佳。',
    walk: '轻轨直达 · 地面观景',
    duration: '约 45 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '免费开放 · 无需预约',
    bestTime: '白天光线充足时',
    amapQuery: { keywords: '李子坝轻轨站', alternatives: ['李子坝', '李子坝地铁站'], matches: ['李子坝(地铁站)', '李子坝单轨穿楼观景平台', '李子坝轻轨站', '李子坝'] },
    intro: '重庆轨道交通2号线李子坝站，因列车直接穿越居民楼而闻名全球。地面设有平整开阔的观景拍照平台，配有无障碍直梯，无需爬山即可轻松捕捉轻轨穿楼奇景。',
    fit: '适合想快速打卡重庆标志性8D魔幻交通、停留时间有限的游客。'
  },
  {
    id: 'cq-grand-theatre',
    name: '重庆大剧院江岸夜景',
    displayName: '重庆大剧院江岸夜景',
    district: '江北区',
    category: '夜景',
    tags: ['夜景', '江岸', '少走路', '拍照', '视野开阔'],
    icon: '景',
    tone: 'green',
    location: '106.577488,29.568471',
    summary: '隔江远眺洪崖洞与千厮门大桥全景，江风拂面且免受人潮拥挤。',
    walk: '轻轨/公交直达 · 短步行',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '江岸公共区域免费',
    bestTime: '19:30 - 22:30',
    amapQuery: { keywords: '重庆大剧院', matches: ['重庆大剧院', '江北嘴江滩公园', '大剧院'] },
    intro: '位于江北嘴江畔，与洪崖洞隔江相望。在这里不仅能拍摄到千厮门大桥与洪崖洞同框的经典夜景机位，还能避开洪崖洞内部的拥挤排队，江滩步道平整，长辈同行极为适宜。',
    fit: '适合少走路、带父母长辈、追求开阔全景视野与舒适夜景体验的旅行者。'
  },
  {
    id: 'cq-ciqikou',
    name: '磁器口古镇',
    displayName: '磁器口古镇',
    district: '沙坪坝区',
    category: '美食',
    tags: ['古镇', '美食', '市井', '非遗小吃'],
    icon: '镇',
    tone: 'gold',
    location: '106.448564,29.582947',
    summary: '千年古镇巴渝风情，陈麻花、毛血旺与老茶馆烟火气十足。',
    walk: '地铁1号线直达 · 青石板路',
    duration: '约 120 分钟',
    indoor: false,
    walkDifficulty: '中',
    ticket: '免费开放 · 无需预约',
    bestTime: '白天至傍晚',
    amapQuery: { keywords: '磁器口古镇', matches: ['磁器口古镇', '磁器口'] },
    intro: '“白日里千人拱手，入夜来万盏明灯”，磁器口曾是嘉陵江畔著名的水陆码头。古镇内保存着大量明清风格院落，沿街汇集毛血旺、手工酸辣粉、现炸麻花等道地巴渝美食。',
    fit: '适合喜爱老街风貌、寻访地道传统小吃、感受老重庆码头市井文化的旅行者。'
  },
  {
    id: 'cq-kuixinglou',
    name: '魁星楼空中天桥',
    displayName: '魁星楼空中天桥',
    district: '渝中区',
    category: '城市',
    tags: ['8D魔幻', '空中连廊', '短停留', '少走路'],
    icon: '楼',
    tone: 'purple',
    location: '106.575042,29.560662',
    summary: '“停在22楼的平街”，魔幻山城空间格局最具代表性的地标。',
    walk: '平街直达 · 零爬坡',
    duration: '约 45 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '免费开放 · 全天',
    bestTime: '全天可游览',
    amapQuery: { keywords: '魁星楼', matches: ['魁星楼', '临江门魁星楼'] },
    intro: '从临江门进入广场看似平地，走到外侧护栏才发现脚下竟是22层悬空大厦。空中天桥横跨峡谷般的高楼之间，完美诠释重庆“你以为的一楼其实是顶楼”的魔幻建筑逻辑。',
    fit: '适合体验8D魔幻地形、摄影爱好者以及不愿爬坡的随行老人。'
  },
  {
    id: 'cq-shibati',
    name: '十八梯传统风貌区',
    displayName: '十八梯传统风貌区',
    district: '渝中区',
    category: '人文',
    tags: ['市井烟火', '老重庆', '夜景', '文创'],
    icon: '梯',
    tone: 'gold',
    location: '106.573215,29.551682',
    summary: '连接上半城与下半城的母城记忆，入夜后吊脚楼灯火温馨如画。',
    walk: '较场口平街进入 · 阶梯与电梯并存',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '中',
    ticket: '免费开放 · 无需预约',
    bestTime: '17:00 - 22:00',
    amapQuery: { keywords: '十八梯传统风貌区', matches: ['十八梯', '十八梯传统风貌区'] },
    intro: '十八梯是老重庆上下半城的纽带。经过精心保护性修缮后，青石板路、巴渝吊脚楼与老黄桷树依旧，融入了非遗手作、特色茶铺与山城夜景，夜间灯光极富层次感。',
    fit: '适合喜欢老城韵味、散步拍照、感受母城历史温度与地道市井情怀的游客。'
  },
  {
    id: 'cq-erling',
    name: '鹅岭二厂文创公园',
    displayName: '鹅岭二厂文创公园',
    district: '渝中区',
    category: '文创',
    tags: ['工业风', '瞰江', '拍照', '文创艺术'],
    icon: '厂',
    tone: 'teal',
    location: '106.529815,29.550182',
    summary: '民国印钞厂改造的工业潮流地标，天台可同时俯瞰两江壮景。',
    walk: '公交/打车直达园区',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '园区免费 · 部分天台另收清洁费',
    bestTime: '下午至日落时分',
    amapQuery: { keywords: '鹅岭二厂', matches: ['鹅岭二厂', '贰厂文创公园'] },
    intro: '前身为重庆印钞厂，斑驳的红砖厂房与工业管道被改造成集艺术画廊、独立咖啡、设计师文创于一体的潮流地标。顶楼天台视野绝佳，可极目远眺两江环抱的城市天际线。',
    fit: '适合青年情侣、文艺青年、拍照摄影及喜欢慢节奏品味咖啡的旅行者。'
  },
  {
    id: 'cq-changjiang-cable',
    name: '长江索道',
    displayName: '长江索道',
    district: '渝中区',
    category: '城市',
    tags: ['空中巴士', '飞渡长江', '地标', '经典打卡'],
    icon: '索',
    tone: 'red',
    location: '106.584982,29.557342',
    summary: '横跨长江的“空中公交”，在车厢中近距离感受江水与楼宇穿行。',
    walk: '地铁小什字站直达',
    duration: '约 60 分钟 (含排队)',
    indoor: true,
    walkDifficulty: '低',
    ticket: '需购票 · 单程约20元',
    bestTime: '傍晚日落或华灯初上时',
    amapQuery: { keywords: '长江索道', matches: ['长江索道', '长江索道景区'] },
    intro: '被誉为“万里长江第一条空中走廊”，全长1166米。乘坐索道轿厢飞渡长江，脚下滚滚江水东逝，两岸摩天大楼林立，体验独一无二的山水立体交融之感。',
    fit: '适合初次抵渝必打卡经典景观、想全方位俯瞰两江四岸风光的游客。'
  },
  {
    id: 'cq-nanshan-yikeshu',
    name: '南山一棵树观景台',
    displayName: '南山一棵树观景台',
    district: '南岸区',
    category: '夜景',
    tags: ['俯瞰全城', '夜景大片', '渝中半岛', '摄影天堂'],
    icon: '树',
    tone: 'gold',
    location: '106.592518,29.548962',
    summary: '南山制高点俯瞰渝中半岛万家灯火，饱览山水之城宏大夜景画卷。',
    walk: '建议打车或旅游专线直达',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '需门票 · 约30元',
    bestTime: '19:30 - 22:00',
    amapQuery: { keywords: '南山一棵树观景台', matches: ['南山一棵树', '南山一棵树观景台'] },
    intro: '位于南山半山腰，是观赏渝中半岛夜景的绝佳制高点。华灯齐放时，两江环抱的渝中半岛如同一艘金碧辉煌的巨型航母，江面波光倒影，气势恢宏。',
    fit: '适合摄影发烧友、情侣夜游、追求震撼城市全景夜色的旅行者。'
  },
  {
    id: 'cq-danzi-shi',
    name: '弹子石老街',
    displayName: '弹子石老街',
    district: '南岸区',
    category: '夜景',
    tags: ['开埠文化', '江岸夜景', '少走路', '美食'],
    icon: '街',
    tone: 'purple',
    location: '106.595874,29.570182',
    summary: '十里老街重温开埠岁月，正对朝天门大剧院江景与喷泉秀。',
    walk: '配有多级户外扶梯 · 少走路友好',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '免费开放 · 全天',
    bestTime: '18:00 - 21:30',
    amapQuery: { keywords: '长嘉汇弹子石老街', matches: ['弹子石老街', '长嘉汇弹子石老街'] },
    intro: '全国首个以开埠文化与退台式坡地建筑打造的4A级景区。老街依南滨路而建，全覆盖自动扶梯，对长辈极其友好。正对朝天门来福士与两江交汇，夜景与音乐喷泉交相辉映。',
    fit: '适合全家出游、长辈陪伴、兼顾美食与惬意江景漫步的旅行者。'
  },
  {
    id: 'cq-guanyinqiao',
    name: '观音桥步行街',
    displayName: '观音桥步行街',
    district: '江北区',
    category: '美食',
    tags: ['时尚商圈', '重庆火锅', '街头小吃', '潮流活力'],
    icon: '桥',
    tone: 'red',
    location: '106.533215,29.576842',
    summary: '重庆本地人最常去的超级商圈，九街不夜城与好吃街美食云集。',
    walk: '地铁3/9号线直达 · 平坦宽敞',
    duration: '约 120 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '免费开放 · 全天',
    bestTime: '傍晚至深夜',
    amapQuery: { keywords: '观音桥步行街', matches: ['观音桥步行街', '观音桥商圈'] },
    intro: '中国著名商业街之一，拥有亚洲最大的户外LED大屏。商圈内拥有数百家重庆老火锅、江湖菜与地道小吃街，邻近九街更是重庆年轻活力的夜生活中心。',
    fit: '适合美食狂热者、喜欢购物逛街、体验重庆地道市井夜生活的年轻人与朋友结伴。'
  },
  {
    id: 'cq-luohan-temple',
    name: '罗汉寺',
    displayName: '罗汉寺',
    district: '渝中区',
    category: '人文',
    tags: ['千年古刹', '闹中取静', '室内', '历史'],
    icon: '寺',
    tone: 'blue',
    location: '106.584215,29.559812',
    summary: '摩天高楼环抱中的千年宋代古刹，《疯狂的石头》取景胜地。',
    walk: '小什字地铁站平街直达',
    duration: '约 60 分钟',
    indoor: true,
    walkDifficulty: '低',
    ticket: '门票约 20 元 (含香火券)',
    bestTime: '08:30 - 17:00',
    amapQuery: { keywords: '罗汉寺', matches: ['罗汉寺', '重庆罗汉寺'] },
    intro: '始建于北宋治平年间的千年名刹，寺内藏有古朴珍贵的五百罗汉泥塑与宋代岩石摩崖石刻。高耸的现代大厦环绕着古刹飞檐，形成奇妙古今对话，内部清幽肃穆。',
    fit: '适合喜爱佛教禅意文化、古建筑、电影取景地寻访及寻求闹市静谧的游客。'
  },
  {
    id: 'cq-huguang-guild',
    name: '湖广会馆',
    displayName: '湖广会馆',
    district: '渝中区',
    category: '人文',
    tags: ['移民文化', '明清古建', '室内', '黄色封火墙'],
    icon: '馆',
    tone: 'blue',
    location: '106.590124,29.555218',
    summary: '全国最大的清代古会馆建筑群，明黄色封火墙气势恢宏。',
    walk: '地铁小什字站转公交/步行',
    duration: '约 90 分钟',
    indoor: true,
    walkDifficulty: '低',
    ticket: '需购票 · 约25元',
    bestTime: '09:00 - 17:00',
    amapQuery: { keywords: '重庆湖广会馆', matches: ['湖广会馆', '重庆湖广会馆'] },
    intro: '坐落于长江之滨，始建于清乾隆年间，是“湖广填四川”历史的珍贵见证。会馆依山造势，拥有精美的木雕石刻、戏楼舞台与标志性的明黄色封火墙，文化底蕴深厚。',
    fit: '适合热爱历史建筑、民俗文化研究、拍照古风写真的旅行者。'
  },
  {
    id: 'cq-zhongshan-road',
    name: '中山四路',
    displayName: '中山四路',
    district: '渝中区',
    category: '人文',
    tags: ['最美林荫道', '抗战遗址', '少走路', '静谧散步'],
    icon: '路',
    tone: 'teal',
    location: '106.545812,29.556218',
    summary: '黄桷树浓荫下的最美历史文化街，桂园与周公馆承载风云岁月。',
    walk: '地势平缓 · 步行极舒适',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '街区免费 · 纪念馆免费开放',
    bestTime: '上午或午后阳光斑驳时',
    amapQuery: { keywords: '中山四路', matches: ['中山四路', '中山四路历史文化街区'] },
    intro: '被誉为“重庆最美林荫大道”，茂密的百年黄桷树掩映着青砖黛瓦。沿线汇集了桂园（重庆谈判签字地）、周公馆、特园等众多抗战历史遗迹，道路平整，清幽宜人。',
    fit: '适合喜欢静心散步、陪伴长辈、品味民国抗战历史与城市慢生活的旅行者。'
  },
  {
    id: 'cq-baiheliang',
    name: '白鹤梁水下博物馆',
    displayName: '白鹤梁水下博物馆',
    district: '涪陵区',
    category: '人文',
    tags: ['世界首座水下博物馆', '水文水石刻', '室内', '国宝级'],
    icon: '梁',
    tone: 'blue',
    location: '107.391215,29.708912',
    summary: '乘长扶梯深入长江水下40米，隔观景窗品读千年水文石刻题跋。',
    walk: '馆内全自动扶梯与直梯',
    duration: '约 90 分钟',
    indoor: true,
    walkDifficulty: '低',
    ticket: '需购票 · 约50元',
    bestTime: '09:00 - 17:00 (周一闭馆)',
    amapQuery: { keywords: '白鹤梁水下博物馆', matches: ['白鹤梁水下博物馆', '白鹤梁'] },
    intro: '被联合国教科文组织誉为“世界首座免减压水下博物馆”。通过91米水下电梯下潜至长江江心深处，隔着特制玻璃舱近距离观赏自唐代起记录长江枯水水位的古石鱼题刻。',
    fit: '适合科技与文物爱好者、亲子科普研学以及深度文化探索者。'
  },
  {
    id: 'cq-wulong-tiankeng',
    name: '武隆天生三桥',
    displayName: '武隆天生三桥',
    district: '武隆区',
    category: '自然',
    tags: ['世界自然遗产', '喀斯特峡谷', '满城尽带黄金甲取景地'],
    icon: '峰',
    tone: 'green',
    location: '107.801215,29.428912',
    summary: '世界最大天生桥群与深邃天坑，峡谷幽深，天福官驿遗世独立。',
    walk: '配观光直梯下坑 · 谷底步行平缓',
    duration: '约 180 分钟',
    indoor: false,
    walkDifficulty: '中',
    ticket: '需门票及中转车',
    bestTime: '四季皆宜 · 清晨烟雾缭绕最佳',
    amapQuery: { keywords: '武隆天生三桥', matches: ['武隆天生三桥', '天生三桥'] },
    intro: '罕见的地质奇观生态型旅游区，拥有天龙桥、青龙桥、黑龙桥三座天然石拱桥。下临深幽天坑，悬崖峭壁如刀劈斧削，谷底保留古朴的天福官驿，宛若仙侠秘境。',
    fit: '适合大自然山水爱好者、徒步摄影、打卡电影经典名场面的旅行者。'
  },
  {
    id: 'cq-dazu-rock',
    name: '大足石刻',
    displayName: '大足石刻 (宝顶山)',
    district: '大足区',
    category: '人文',
    tags: ['世界文化遗产', '东方石窟艺术巅峰', '室内外展陈'],
    icon: '石',
    tone: 'blue',
    location: '105.789124,29.748912',
    summary: '唐宋摩崖石刻艺术集大成者，千手观音与卧佛造像精美绝伦。',
    walk: '园区观光车接驳 · 平缓步道',
    duration: '约 180 分钟',
    indoor: true,
    walkDifficulty: '低',
    ticket: '需门票',
    bestTime: '08:30 - 17:00',
    amapQuery: { keywords: '大足石刻', matches: ['大足石刻', '宝顶山石刻'] },
    intro: '中国石窟艺术史上最后的丰碑，以规模宏大、雕刻精美、题材丰富著称。宝顶山石刻以大佛湾为核心，展现了佛、道、儒三教合一的独特造像艺术，千手观音金光庄严。',
    fit: '适合古建雕塑艺术鉴赏家、文史学者及深度探寻巴蜀文化底蕴的旅行者。'
  },
  {
    id: 'cq-ronghui-hotspring',
    name: '融汇温泉',
    displayName: '融汇温泉',
    district: '沙坪坝区',
    category: '休闲',
    tags: ['天然地热温泉', '养生放松', '长辈最爱', '室内外'],
    icon: '泉',
    tone: 'teal',
    location: '106.458912,29.541215',
    summary: '都市核心区高品质天然硫酸盐泉，洗去旅途疲惫、舒缓身心。',
    walk: '园区内部平坦 · 设施完备',
    duration: '约 180 分钟',
    indoor: true,
    walkDifficulty: '低',
    ticket: '需门票',
    bestTime: '下午至晚间',
    amapQuery: { keywords: '融汇温泉', matches: ['重庆融汇温泉', '融汇温泉城'] },
    intro: '依托沙坪坝地下优质地热资源打造的都市生态温泉。设有动感水疗区、养生药浴汤池及舒适室内休息厅，环境优雅，是慢游重庆舒缓肌肉与放松身心的理想去处。',
    fit: '适合全家度假、孝敬长辈、在紧凑行程之余享受惬意私享时光的旅行者。'
  },
  {
    id: 'cq-south-hotspring',
    name: '南温泉风景区',
    displayName: '南温泉风景区',
    district: '巴南区',
    category: '自然',
    tags: ['山水峡谷', '古温泉', '休闲漫步', '森林氧吧'],
    icon: '溪',
    tone: 'green',
    location: '106.598912,29.421215',
    summary: '温塘峡谷水清木华，十二景名胜与天然温泉交融的山水胜境。',
    walk: '峡谷步道平坦',
    duration: '约 120 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '景区免费 · 温泉另购',
    bestTime: '四季皆宜',
    amapQuery: { keywords: '南温泉风景区', matches: ['南温泉', '南温泉风景区'] },
    intro: '自古为巴渝名胜，花溪河穿峡而过，两岸悬崖滴翠。景区内不仅有历史悠久的温泉眼，还拥有古仙女洞、建文遗址等古迹，林荫蔽日，空气清新。',
    fit: '适合近郊吸氧洗肺、轻松徒步、寻访自然山水幽静的旅行者。'
  },
  {
    id: 'cq-geleyuan',
    name: '歌乐山烈士陵园与渣滓洞',
    displayName: '歌乐山红色遗址',
    district: '沙坪坝区',
    category: '人文',
    tags: ['红色记忆', '历史风云', '红岩精神', '爱国教育'],
    icon: '松',
    tone: 'red',
    location: '106.431215,29.578912',
    summary: '追寻红岩风骨与革命热血，重温那段荡气回肠的英雄史诗。',
    walk: '专线观光车接驳各景点',
    duration: '约 120 分钟',
    indoor: true,
    walkDifficulty: '中',
    ticket: '免费开放 · 需提前实名预约',
    bestTime: '09:00 - 16:30',
    amapQuery: { keywords: '渣滓洞', matches: ['渣滓洞', '白公馆', '歌乐山烈士陵园'] },
    intro: '包括渣滓洞、白公馆与红岩魂陈列馆等重要旧址，是红岩精神的核心发源地。陈列展示了大量珍贵的革命先烈手迹与历史物件，令人肃然起敬。',
    fit: '适合党建教育、带青少年研学、了解重庆近现代风云历史的家庭与团队。'
  },
  {
    id: 'cq-maanshan',
    name: '马鞍山传统风貌区',
    displayName: '马鞍山传统风貌区',
    district: '南岸区',
    category: '文创',
    tags: ['开埠建筑群', '山城慢调', '茶饮咖啡', '拍照出片'],
    icon: '山',
    tone: 'teal',
    location: '106.581215,29.548912',
    summary: '掩映在黄桷树下的开埠老洋房，品茗瞰江享受悠闲午后。',
    walk: '阶梯缓坡 · 景致幽雅',
    duration: '约 90 分钟',
    indoor: false,
    walkDifficulty: '低',
    ticket: '免费开放 · 全天',
    bestTime: '午后至傍晚',
    amapQuery: { keywords: '马鞍山传统风貌区', matches: ['马鞍山', '马鞍山传统风貌区'] },
    intro: '坐落于南岸南滨路上方，保留了众多中西合璧的近代开埠老建筑和民居院落。青砖灰瓦、绿树成荫，错落分布着格调茶室、文创空间，极富岁月静好之感。',
    fit: '适合避开热门人潮、品味老重庆慢生活、闺蜜情侣拍照探店的旅行者。'
  },
  {
    id: 'cq-beicang',
    name: '北仓文创街区',
    displayName: '北仓文创街区',
    district: '江北区',
    category: '文创',
    tags: ['城市书房', '纺织老仓库', '潮流手作', '文艺社区'],
    icon: '仓',
    tone: 'teal',
    location: '106.539812,29.579812',
    summary: '闹市中遗世独立的纺织老仓库，城市公共图书馆与手作空间。',
    walk: '观音桥平街步行可达',
    duration: '约 60 分钟',
    indoor: true,
    walkDifficulty: '低',
    ticket: '免费开放 · 全天',
    bestTime: '全天可游览',
    amapQuery: { keywords: '北仓文创街区', matches: ['北仓', '北仓文创街区'] },
    intro: '由江北纺织仓库改建而成，隐藏在观音桥繁华闹市旁的老居民区深处。拥有温馨通透的北仓图书馆、手工作坊和创意集市，充满安静温润的人文质感。',
    fit: '适合喜爱读书阅读、挑选原创手作、享受闹中取静城市角落的旅行者。'
  },
  ...EXPANDED_ATTRACTIONS
]);

export const ATTRACTIONS_MAP = new Map(ATTRACTIONS_DATA.map((item) => [item.id, item]));

export const LIVE_POI_QUERIES = Object.freeze(
  Object.fromEntries(ATTRACTIONS_DATA.map((item) => [item.id, item.amapQuery]))
);

export const ATTRACTION_NAMES = Object.freeze(
  Object.fromEntries(ATTRACTIONS_DATA.map((item) => [item.id, item.name]))
);

export const STOP_INTERESTS = Object.freeze(
  Object.fromEntries(ATTRACTIONS_DATA.map((item) => [item.id, item.tags]))
);

export const EXPLORE_ITEMS = Object.freeze(
  ATTRACTIONS_DATA.map((item) => ({
    id: item.id,
    name: item.name,
    district: item.district,
    category: item.category,
    tags: item.tags,
    audienceTags: item.audienceTags || [],
    catalogStatus: item.catalogStatus || 'verified',
    summary: item.summary,
    fit: item.fit,
    icon: item.icon,
    tone: item.tone,
    location: item.location,
    ticket: item.ticket,
    duration: item.duration,
    walk: item.walk,
    indoor: item.indoor
  }))
);
