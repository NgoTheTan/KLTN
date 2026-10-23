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

export interface ClassifyOutput {
  type: RequirementType;
  platforms: Platform[];
  is_asr: boolean;
  quality_attributes: string[];
}

// Quality attribute keywords (bilingual)

const QUALITY_KEYWORDS: Record<string, { vi: string[]; en: string[] }> = {
  performance: {
    en: ['response time', 'latency', 'throughput', 'milliseconds', 'seconds', 'concurrent', 'load'],
    vi: ['thời gian phản hồi', 'độ trễ', 'thông lượng', 'mili giây', 'giây', 'đồng thời', 'tải'],
  },
  reliability: {
    en: ['availability', 'uptime', 'fault', 'recovery', 'backup', 'failover', 'redundancy'],
    vi: ['khả dụng', 'thời gian hoạt động', 'lỗi', 'phục hồi', 'sao lưu', 'dự phòng'],
  },
  security: {
    en: ['authentication', 'authorization', 'encrypt', 'tls', 'https', 'permission', 'audit'],
    vi: ['xác thực', 'phân quyền', 'mã hoá', 'quyền', 'nhật ký kiểm toán'],
  },
  usability: {
    en: ['user-friendly', 'accessible', 'wcag', 'i18n', 'locale', 'responsive'],
    vi: ['thân thiện', 'dễ dùng', 'đa ngôn ngữ', 'truy cập'],
  },
  maintainability: {
    en: ['ota', 'update', 'firmware', 'version', 'deploy', 'monitor', 'log'],
    vi: ['cập nhật', 'firmware', 'phiên bản', 'triển khai', 'giám sát', 'nhật ký'],
  },
  scalability: {
    en: ['scale', 'concurrent users', 'horizontal', 'vertical', 'elastic'],
    vi: ['mở rộng', 'người dùng đồng thời', 'co dãn'],
  },
};

// Platform keywords

const PLATFORM_KEYWORDS: Record<Platform, { vi: string[]; en: string[] }> = {
  iot: {
    en: ['mqtt', 'coap', 'firmware', 'sensor', 'device', 'gateway', 'ota', 'mcu', 'embedded', 'edge', 'broker'],
    vi: ['mqtt', 'firmware', 'cảm biến', 'thiết bị', 'cổng', 'vi điều khiển', 'nhúng', 'biên'],
  },
  mobile: {
    en: ['ios', 'android', 'push notification', 'app store', 'google play', 'offline', 'keychain', 'battery'],
    vi: ['ios', 'android', 'thông báo đẩy', 'cửa hàng ứng dụng', 'ngoại tuyến', 'pin'],
  },
  web: {
    en: ['browser', 'spa', 'http', 'https', 'rest', 'graphql', 'seo', 'ssr', 'css', 'responsive'],
    vi: ['trình duyệt', 'tải trang', 'seo', 'responsive'],
  },
  shared: { en: [], vi: [] },
};

export class S3ClassifyAndTag {
  /**
   * Tier 0: Classify using keyword dictionaries.
   */
  tier0(text: string, language: 'vi' | 'en'): { type: RequirementType; platforms: Platform[]; is_asr: boolean; confidence: number } {
    const lower = text.toLowerCase();

    // Detect platforms
    const platforms: Platform[] = [];
    for (const [platform, kws] of Object.entries(PLATFORM_KEYWORDS)) {
      const keywords = language === 'vi' ? kws.vi : kws.en;
      if (keywords.some(kw => lower.includes(kw))) {
        platforms.push(platform as Platform);
      }
    }
    if (platforms.length === 0) platforms.push('shared');

    // Detect quality attributes → non-functional
    const detectedAttribs: string[] = [];
    for (const [attr, kws] of Object.entries(QUALITY_KEYWORDS)) {
      const keywords = language === 'vi' ? kws.vi : kws.en;
      if (keywords.some(kw => lower.includes(kw))) {
        detectedAttribs.push(attr);
      }
    }

    // Has numeric measure → likely non-functional
    const hasMetric = /\d+\s*(ms|s|%|mb|gb|rpm|rps|tps|req\/s)/i.test(text);

    let type: RequirementType = 'functional';
    if (detectedAttribs.length > 0 || hasMetric) {
      type = 'non-functional';
    }

    // ASR: non-functional with measurable metric, or constraint affecting architecture
    const is_asr = type === 'non-functional' && hasMetric;

    return {
      type,
      platforms,
      is_asr,
      confidence: detectedAttribs.length > 0 || hasMetric ? 0.8 : 0.6,
    };
  }
}
