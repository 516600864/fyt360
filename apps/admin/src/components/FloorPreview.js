// 楼层近似预览组件（渲染器观感的纯展示 mock）—— DIY 编辑器与 AI 装修页共用
// 2026-09-28 补齐：与 C 端渲染器 27 组件对齐（此前仅 13 个，新组件全落"未上线"兜底被 D先生 抓包）
import './floor-preview.css';
import { defineComponent, h } from 'vue';

export default defineComponent({
  name: 'FloorPreview',
  props: { floor: { type: Object, required: true } },
  setup(p) {
    return () => {
      const f = p.floor;
      const pr = f.props ?? {};
      if (f.type === 'search-bar') {
        return h('div', { class: 'pv pv-search' }, [
          h('span', { class: 'pv-logo' }, pr.logo_text ?? '券'),
          h('span', { class: 'pv-ph' }, pr.placeholder ?? ''),
          h('span', { class: 'pv-action' }, pr.action_text ?? ''),
        ]);
      }
      if (f.type === 'swiper') {
        const it = (pr.items ?? [])[0] ?? {};
        const kids = [];
        if (it.img) {
          kids.push(h('img', { class: 'pv-b-img', src: it.img, alt: '' }));
          kids.push(h('div', { class: 'pv-b-scrim' }));
        }
        kids.push(h('div', { class: 'pv-b-main' }, `${it.title ?? ''}${it.emphasize ? ' · ' + it.emphasize : ''}`));
        kids.push(h('div', { class: 'pv-b-tags' }, (it.tags ?? []).join(' · ')));
        kids.push(h('div', { class: 'pv-b-tail' }, `${it.tail ?? ''} ${it.img ? '' : it.emoji ?? ''}`));
        return h('div', { class: 'pv pv-banner' + (it.img ? ' has-img' : ''), style: it.img ? {} : { background: it.bg ?? '#e8336d' } }, kids);
      }
      if (f.type === 'nav') {
        return h('div', { class: 'pv pv-nav', style: { gridTemplateColumns: `repeat(${pr.columns ?? 5}, 1fr)` } },
          (pr.items ?? []).slice(0, 10).map((it) => h('div', { class: 'pv-nav-it' }, [
            h('span', { class: 'pv-nav-ic' }, it.icon ?? '✨'),
            h('span', { class: 'pv-nav-lb' }, it.label ?? ''),
          ])));
      }
      if (f.type === 'coupon-strip') {
        return h('div', { class: 'pv pv-coupon' }, [
          h('span', { class: 'pv-c-amt' }, pr.amount ?? ''),
          h('span', { class: 'pv-c-note' }, `${pr.note_top ?? ''} ${pr.note_bottom ?? ''}`),
          h('span', { class: 'pv-c-btn' }, pr.coupon_id ? `${pr.action_text ?? '立即领取'}（券ID ${pr.coupon_id}）` : (pr.action_text ?? '')),
        ]);
      }
      if (f.type === 'brand-chips') {
        return h('div', { class: 'pv pv-brands' }, [
          h('div', { class: 'pv-br-head' }, [h('b', null, pr.title ?? ''), h('span', { class: 'pv-br-badge' }, pr.badge ?? '')]),
          h('div', { class: 'pv-br-chips' }, (pr.chips ?? []).map((c) => h('span', { class: 'pv-chip' }, typeof c === 'object' ? c.label : c))),
        ]);
      }
      if (f.type === 'goods-feed') {
        const mode = f.data_source?.mode ?? 'platform_tab';
        const selfCnt = (f.data_source?.params?.goods_ids ?? []).length;
        return h('div', { class: 'pv pv-feed' }, [
          h('div', { class: 'pv-feed-head' }, [
            h('b', null, pr.title ?? ''),
            h('span', { class: 'pv-feed-more' }, mode === 'self'
              ? `团购 · 已选 ${selfCnt} 件${pr.badge ? ' · 挂标' : ''}`
              : (pr.more_text ?? '')),
          ]),
          h('div', { class: 'pv-feed-grid', style: mode === 'self' && pr.layout === 'big' ? 'grid-template-columns:1fr' : '' },
            Array.from({ length: mode === 'self' && pr.layout === 'big' ? 2 : 4 }).map((_, i) =>
            h('div', { class: 'pv-gcard' }, [
              h('div', { class: 'pv-gimg' }, ['🛍️', '🍔', '☕', '🎁'][i]),
              h('div', { class: 'pv-gt' }, mode === 'self' ? (f.data_source?.params?.__picked?.[i]?.title ?? '团购商品占位') : '商品标题占位'),
              h('div', { class: 'pv-gp' }, '¥ 39.9 起'),
            ]))),
        ]);
      }
      if (f.type === 'notice') {
        return h('div', { class: 'pv pv-notice' }, [
          h('span', { class: 'pv-n-ic' }, '📢'),
          h('span', { class: 'pv-n-txt' }, (pr.texts ?? [])[0] ?? '公告占位'),
        ]);
      }
      if (f.type === 'divider') {
        return h('div', { class: 'pv pv-divider' }, [
          h('span', { class: 'pv-dv-line' }),
          h('b', { class: 'pv-dv-title' }, pr.title ?? ''),
          h('span', { class: 'pv-dv-line' }),
        ]);
      }
      if (f.type === 'rich-text') {
        return h('div', { class: 'pv pv-rt' }, [
          h('div', { class: 'pv-rt-head' }, [h('b', null, pr.title ?? ''), h('span', { class: 'pv-rt-badge' }, pr.badge ?? '')]),
          ...((pr.paras ?? []).slice(0, 2).map((p2) => h('div', { class: 'pv-rt-p' }, p2))),
        ]);
      }
      if (f.type === 'blank') {
        return h('div', { class: 'pv pv-blank', style: { height: Math.min((pr.height ?? 24) / 2, 60) + 'px' } }, '⸺ 间距 ⸺');
      }
      if (f.type === 'ingot-entry') {
        return h('div', { class: 'pv pv-ingot' }, [
          h('div', { class: 'pv-ig-l' }, [
            h('span', { class: 'pv-ig-coin' }, '🧡'),
            h('div', { class: 'pv-ig-t' }, [
              h('b', null, pr.title ?? ''),
              h('span', { class: 'pv-ig-sub' }, pr.subtitle ?? ''),
            ]),
          ]),
          h('span', { class: 'pv-ig-btn' }, `${pr.action_text ?? '去查看'} ›`),
        ]);
      }
      if (f.type === 'movie-box') {
        return h('div', { class: 'pv pv-movie' }, [
          h('div', { class: 'pv-mv-head' }, [
            h('b', null, pr.title || (pr.mode === 'upcoming' ? '即将上映' : '热门电影')),
            h('span', { class: 'pv-mv-more' }, pr.more || '查看更多'),
          ]),
          h('div', { class: 'pv-mv-grid' }, [1, 2].map((i) =>
            h('div', { class: 'pv-mv-card', key: i }, [
              h('div', { class: 'pv-mv-poster' }, '🎬'),
              h('div', { class: 'pv-mv-name' }, '热映影片'),
              h('div', { class: 'pv-mv-price' }, '¥ 24.9 起'),
            ]))),
          h('div', { class: 'pv-mv-note' }, '小程序端渲染插件真实购票列表'),
        ]);
      }
      if (f.type === 'redeem-entry') {
        return h('div', { class: 'pv pv-redeem' }, [
          h('span', { class: 'pv-rd-emoji' }, pr.emoji ?? '🎬'),
          h('div', { class: 'pv-rd-t' }, [
            h('b', null, pr.title ?? ''),
            h('span', { class: 'pv-rd-sub' }, pr.subtitle ?? ''),
          ]),
          h('span', { class: 'pv-rd-btn' }, `${pr.btn_text ?? '立即抢'} ›`),
        ]);
      }
      // ===== 以下为 2026-09-28 补齐的 14 组件近似预览（与 C 端渲染器 props 对齐） =====
      if (f.type === 'floor') {
        return h('div', { class: 'pv pv-floor', style: pr.bg ? { background: pr.bg } : {} }, [
          pr.title ? h('div', { class: 'pv-fl-head' }, [
            h('b', null, pr.title),
            pr.subtitle ? h('span', { class: 'pv-fl-sub' }, pr.subtitle) : null,
          ]) : null,
          pr.text ? h('div', { class: 'pv-fl-text' }, pr.text) : null,
        ]);
      }
      if (f.type === 'float-btn') {
        return h('div', { class: 'pv pv-float' }, [
          pr.icon ? h('span', null, pr.icon + ' ') : null,
          h('span', null, pr.text ?? '点我'),
        ]);
      }
      if (f.type === 'category-nav') {
        return h('div', { class: 'pv pv-catnav' },
          (pr.items ?? []).slice(0, 6).map((it, i) =>
            h('span', { class: 'pv-cat-chip' + (it.hot ? ' hot' : ''), key: i }, it.label ?? '')));
      }
      if (f.type === 'member-card') {
        return h('div', { class: 'pv pv-member', style: pr.bg ? { background: pr.bg } : {} }, [
          h('div', { class: 'pv-mc-l' }, [
            h('b', null, pr.title ?? '会员权益中心'),
            h('span', { class: 'pv-mc-sub' }, pr.subtitle ?? ''),
            pr.level_text ? h('span', { class: 'pv-mc-lv' }, pr.level_text) : null,
          ]),
          h('span', { class: 'pv-mc-btn' }, `${pr.btn_text ?? '立即开通'} ›`),
        ]);
      }
      if (f.type === 'brand-matrix') {
        const cols = pr.columns ?? 4;
        return h('div', { class: 'pv pv-bmatrix', style: { gridTemplateColumns: `repeat(${cols}, 1fr)` } },
          (pr.items ?? []).slice(0, cols * 2).map((it, i) =>
            h('div', { class: 'pv-bm-cell', key: i }, [
              h('span', { class: 'pv-bm-ic' }, it.icon ?? '🏷️'),
              h('span', { class: 'pv-bm-name' }, it.name ?? ''),
              it.tag ? h('span', { class: 'pv-bm-tag' }, it.tag) : null,
            ])));
      }
      if (f.type === 'activity-floor') {
        return h('div', { class: 'pv pv-activity', style: pr.bg ? { background: pr.bg } : {} }, [
          pr.image ? h('img', { class: 'pv-ac-img', src: pr.image, alt: '' }) : null,
          h('b', { class: 'pv-ac-title' }, pr.title ?? ''),
          pr.subtitle ? h('span', { class: 'pv-ac-sub' }, pr.subtitle) : null,
          h('div', { class: 'pv-ac-btns' },
            (pr.buttons ?? []).slice(0, 2).map((b, i) =>
              h('span', { class: 'pv-ac-btn' + (b.ghost ? ' ghost' : ''), key: i }, b.text ?? '参与'))),
        ]);
      }
      if (f.type === 'image-hotzone') {
        return h('div', { class: 'pv pv-hotzone' },
          pr.image
            ? [h('img', { class: 'pv-hz-img', src: pr.image, alt: '' })]
            : [h('div', { class: 'pv-hz-ph' }, `🖼️ 图片热区 · ${(pr.zones ?? []).length} 个热区`)],
        );
      }
      if (f.type === 'video-floor') {
        return h('div', { class: 'pv pv-video' }, [
          pr.title ? h('b', { class: 'pv-vf-title' }, pr.title) : null,
          h('div', { class: 'pv-vf-box' }, [
            pr.poster ? h('img', { class: 'pv-vf-poster', src: pr.poster, alt: '' }) : null,
            h('span', { class: 'pv-vf-play' }, '▶'),
          ]),
        ]);
      }
      if (f.type === 'countdown') {
        return h('div', { class: 'pv pv-countdown' }, [
          h('div', { class: 'pv-cd-head' }, [h('b', null, pr.title ?? '限时开抢'), pr.note ? h('span', { class: 'pv-cd-note' }, pr.note) : null]),
          h('div', { class: 'pv-cd-timer' }, [
            h('span', { class: 'pv-cd-cell' }, '08'), h('i', null, '时'),
            h('span', { class: 'pv-cd-cell' }, '42'), h('i', null, '分'),
            h('span', { class: 'pv-cd-cell' }, '15'), h('i', null, '秒'),
          ]),
        ]);
      }
      if (f.type === 'popup-modal') {
        return h('div', { class: 'pv pv-popup' }, [
          pr.image ? h('img', { class: 'pv-pp-img', src: pr.image, alt: '' }) : null,
          h('b', null, pr.title ?? '进页弹窗'),
          h('span', { class: 'pv-pp-txt' }, pr.content ?? ''),
          h('span', { class: 'pv-pp-btn' }, pr.btn_text ?? '知道了'),
        ]);
      }
      if (f.type === 'seckill') {
        return h('div', { class: 'pv pv-seckill' }, [
          h('div', { class: 'pv-sk-head' }, [
            h('b', null, pr.title ?? '限时秒杀'),
            pr.deadline ? h('span', { class: 'pv-sk-cd' }, '⏱ 01:23:45') : null,
            h('span', { class: 'pv-sk-more' }, pr.more_text ?? ''),
          ]),
          h('div', { class: 'pv-sk-grid' },
            (pr.items ?? []).slice(0, 3).map((it, i) =>
              h('div', { class: 'pv-sk-card', key: i }, [
                h('div', { class: 'pv-sk-pic' }, it.pic ? h('img', { src: it.pic, alt: '' }) : '🛍️'),
                h('span', { class: 'pv-sk-name' }, it.title ?? '秒杀商品'),
                h('div', { class: 'pv-sk-pr' }, [
                  h('b', null, `¥${it.price ?? '9.9'}`),
                  it.origin_price ? h('s', null, `¥${it.origin_price}`) : null,
                ]),
              ]))),
        ]);
      }
      if (f.type === 'group-buy-floor') {
        return h('div', { class: 'pv pv-gbuy' }, [
          h('div', { class: 'pv-gb-head' }, [h('b', null, pr.title ?? '超值拼团'), h('span', { class: 'pv-gb-sub' }, pr.subtitle ?? '')]),
          h('div', { class: 'pv-gb-grid' },
            (pr.items ?? []).slice(0, 2).map((it, i) =>
              h('div', { class: 'pv-gb-card', key: i }, [
                h('div', { class: 'pv-gb-pic' }, it.pic ? h('img', { src: it.pic, alt: '' }) : '🧧'),
                h('span', { class: 'pv-gb-name' }, it.title ?? '拼团商品'),
                h('div', { class: 'pv-sk-pr' }, [
                  h('b', null, `¥${it.group_price ?? '19.9'}`),
                  it.price ? h('s', null, `¥${it.price}`) : null,
                ]),
                h('span', { class: 'pv-gb-btn' }, '去拼团'),
              ]))),
        ]);
      }
      if (f.type === 'coupon-wall') {
        return h('div', { class: 'pv pv-cwall' }, [
          h('div', { class: 'pv-gb-head' }, [h('b', null, pr.title ?? '券墙中心'), h('span', { class: 'pv-gb-sub' }, pr.subtitle ?? '')]),
          h('div', { class: 'pv-cw-list' },
            (pr.coupons ?? []).slice(0, 3).map((c, i) =>
              h('div', { class: 'pv-cw-card', key: i }, [
                h('div', { class: 'pv-cw-l' }, [
                  h('b', null, `¥${c.amount ?? '5'}`),
                  h('span', null, c.condition ?? '无门槛'),
                ]),
                h('span', { class: 'pv-cw-btn' }, c.btn_text ?? '立即领取'),
              ]))),
        ]);
      }
      if (f.type === 'invite-floor') {
        return h('div', { class: 'pv pv-invite' }, [
          h('div', { class: 'pv-iv-l' }, [
            h('b', null, pr.title ?? '邀请有礼'),
            h('span', { class: 'pv-iv-desc' }, pr.desc ?? ''),
            h('span', { class: 'pv-iv-reward' }, `🎁 ${pr.reward_text ?? ''}`),
          ]),
          h('span', { class: 'pv-iv-btn' }, pr.btn_text ?? '立即邀请'),
        ]);
      }
      return h('div', { class: 'pv pv-unknown' }, `[${f.type}] 组件未上线，端内渲染为占位框`);
    };
  },
});
