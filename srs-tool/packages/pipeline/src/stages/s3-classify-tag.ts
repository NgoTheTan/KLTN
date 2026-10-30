/**
 * S3: Classify and Tag Requirements
 *
 * Responsibilities:
 * - Classify: functional, non-functional, constraint, interface, assumption
 * - Tag platform: web, mobile, iot, shared
 * - Mark ASR (Architecturally Significant Requirements)
 * - Update bilingual glossary (Vi-En term pairs)
 *
 * Three-tier:
 * - Tier 0: Quality attribute dictionary (ISO/IEC 25010 bilingual),
 *           numeric expressions and units, functional verbs,
 *           platform keywords (MQTT, firmware, sensor; iOS, Android, push; browser, SEO)
 * - Tier 1: Classifier on embeddings
 * - Tier 2: Small LLM for conflicting-label items
 */

import type { Platform, RequirementType } from '@srs-tool/schemas';
import { wordsRegex } from '../text.js';

export interface ClassifyOutput {
  type: RequirementType;
  platforms: Platform[];
  is_asr: boolean;
  quality_attributes: string[];
}

export interface Tier0ClassifyResult extends ClassifyOutput {
  confidence: number;
}

type Lang = 'vi' | 'en';

// Quality attribute keywords (bilingual, ISO/IEC 25010)

const QUALITY_KEYWORDS: Record<string, { vi: string[]; en: string[] }> = {
  performance: {
    en: ['response time', 'latency', 'throughput', 'milliseconds', 'seconds', 'concurrent', 'load', 'performance'],
    vi: ['thời gian phản hồi', 'độ trễ', 'thông lượng', 'mili giây', 'giây', 'đồng thời', 'tải', 'hiệu năng'],
  },
  reliability: {
    en: ['availability', 'uptime', 'fault', 'recovery', 'backup', 'failover', 'redundancy', 'reliability'],
    vi: ['khả dụng', 'thời gian hoạt động', 'lỗi', 'phục hồi', 'sao lưu', 'dự phòng', 'độ tin cậy'],
  },
  security: {
    en: ['authentication', 'authorization', 'encrypt', 'encrypted', 'encryption', 'tls', 'https', 'permission', 'audit', 'security'],
    vi: ['xác thực', 'phân quyền', 'mã hoá', 'mã hóa', 'quyền', 'nhật ký kiểm toán', 'bảo mật'],
  },
  usability: {
    en: ['user-friendly', 'accessible', 'accessibility', 'wcag', 'i18n', 'locale', 'usability'],
    vi: ['thân thiện', 'dễ dùng', 'đa ngôn ngữ', 'truy cập', 'khả dụng sử dụng'],
  },
  maintainability: {
    en: ['ota', 'firmware update', 'deploy', 'monitoring', 'logging', 'maintainability'],
    vi: ['cập nhật từ xa', 'triển khai', 'giám sát', 'ghi log', 'bảo trì'],
  },
  scalability: {
    en: ['scale', 'scalable', 'scalability', 'concurrent users', 'horizontal', 'elastic'],
    vi: ['mở rộng', 'người dùng đồng thời', 'co dãn'],
  },
};

// Platform keywords

const PLATFORM_KEYWORDS: Record<Exclude<Platform, 'shared'>, { vi: string[]; en: string[] }> = {
  iot: {
    en: ['mqtt', 'coap', 'firmware', 'sensor', 'sensors', 'device', 'devices', 'gateway', 'ota', 'mcu', 'embedded', 'edge', 'broker', 'telemetry'],
    vi: ['mqtt', 'coap', 'firmware', 'cảm biến', 'thiết bị', 'cổng kết nối', 'vi điều khiển', 'nhúng', 'biên', 'telemetry'],
  },
  mobile: {
    en: ['ios', 'android', 'push notification', 'app store', 'google play', 'offline', 'keychain', 'battery', 'mobile app'],
    vi: ['ios', 'android', 'thông báo đẩy', 'cửa hàng ứng dụng', 'ngoại tuyến', 'pin', 'ứng dụng di động'],
  },
  web: {
    en: ['browser', 'spa', 'rest', 'graphql', 'seo', 'ssr', 'css', 'web app', 'web portal', 'dashboard'],
    vi: ['trình duyệt', 'tải trang', 'seo', 'cổng web', 'trang web', 'bảng điều khiển'],
  },
};

// Type indicators beyond functional / NFR

const CONSTRAINT_EN = wordsRegex(['must be implemented in', 'must use', 'shall use', 'shall comply', 'must comply', 'compliant with', 'regulation', 'budget', 'deadline', 'legacy', 'limited to', 'only on']);
const CONSTRAINT_VI = wordsRegex(['phải sử dụng', 'bắt buộc sử dụng', 'tuân thủ', 'phù hợp với quy định', 'ngân sách', 'hạn chót', 'giới hạn', 'chỉ chạy trên']);
const INTERFACE_EN = wordsRegex(['interface with', 'integrate with', 'integration with', 'api', 'protocol', 'exchange data with', 'connect to', 'third-party', 'webhook']);
const INTERFACE_VI = wordsRegex(['giao tiếp với', 'tích hợp', 'tích hợp với', 'giao thức', 'trao đổi dữ liệu', 'kết nối với', 'bên thứ ba']);
const ASSUMPTION_EN = wordsRegex(['assume', 'assumed', 'assumption', 'it is assumed', 'provided that', 'depends on']);
const ASSUMPTION_VI = wordsRegex(['giả định', 'giả sử', 'phụ thuộc vào', 'với điều kiện']);

const METRIC = /\d+(?:[.,]\d+)?\s*(ms|s|giây|phút|%|mb|gb|kb|rpm|rps|tps|req\/s|users?|người dùng|devices?|thiết bị|msg\/s)/i;

function buildMatchers(dict: Record<string, { vi: string[]; en: string[] }>, lang: Lang): Map<string, RegExp> {
  const m = new Map<string, RegExp>();
  for (const [k, v] of Object.entries(dict)) {
    const words = lang === 'vi' ? v.vi : v.en;
    if (words.length > 0) m.set(k, wordsRegex(words));
  }
  return m;
}

const QUALITY_MATCHERS: Record<Lang, Map<string, RegExp>> = {
  vi: buildMatchers(QUALITY_KEYWORDS, 'vi'),
  en: buildMatchers(QUALITY_KEYWORDS, 'en'),
};
const PLATFORM_MATCHERS: Record<Lang, Map<string, RegExp>> = {
  vi: buildMatchers(PLATFORM_KEYWORDS, 'vi'),
  en: buildMatchers(PLATFORM_KEYWORDS, 'en'),
};

export class S3ClassifyAndTag {
  /**
   * Tier 0: Classify using keyword dictionaries.
   */
  tier0(text: string, language: Lang): Tier0ClassifyResult {
    // Detect platforms (Vietnamese specs frequently use English tech terms → check both)
    const platforms: Platform[] = [];
    for (const lang of [language, language === 'vi' ? 'en' : 'vi'] as Lang[]) {
      for (const [platform, re] of PLATFORM_MATCHERS[lang]) {
        if (re.test(text) && !platforms.includes(platform as Platform)) platforms.push(platform as Platform);
      }
    }
    if (platforms.length === 0) platforms.push('shared');

    // Detect quality attributes
    const quality: string[] = [];
    for (const lang of [language, language === 'vi' ? 'en' : 'vi'] as Lang[]) {
      for (const [attr, re] of QUALITY_MATCHERS[lang]) {
        if (re.test(text) && !quality.includes(attr)) quality.push(attr);
      }
    }

    const hasMetric = METRIC.test(text);

    // Type decision — order matters: assumption > constraint > interface > NFR > functional
    let type: RequirementType = 'functional';
    let confidence = 0.6;
    const assumption = (language === 'vi' ? ASSUMPTION_VI : ASSUMPTION_EN).test(text);
    const constraint = (language === 'vi' ? CONSTRAINT_VI : CONSTRAINT_EN).test(text);
    const iface = (language === 'vi' ? INTERFACE_VI : INTERFACE_EN).test(text);

    if (assumption) {
      type = 'assumption';
      confidence = 0.85;
    } else if (constraint) {
      type = 'constraint';
      confidence = 0.82;
    } else if (iface && quality.length === 0) {
      type = 'interface';
      confidence = 0.8;
    } else if (quality.length > 0 || hasMetric) {
      type = 'non-functional';
      confidence = quality.length > 0 && hasMetric ? 0.9 : 0.8;
    }

    // Conflicting signals (e.g. NFR keywords + interface wording) lower confidence → escalate
    if (type === 'non-functional' && iface) confidence = Math.min(confidence, 0.7);

    // ASR: NFR with measurable metric, or constraint affecting architecture
    const is_asr = (type === 'non-functional' && hasMetric) || (type === 'constraint' && quality.length > 0);

    return { type, platforms, is_asr, quality_attributes: quality, confidence };
  }
}
