import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Sparkles, Package, TrendingUp, ChevronDown, ChevronRight, AlertTriangle, Target, Layers, DollarSign, Filter } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API = '/api/insights';

const T = {
  bg: '#FFFFFF',
  cardBg: '#FFFFFF',
  cardShadow: '0 2px 8px rgba(0,0,0,0.08)',
  cardRadius: '12px',
  border: '#E8E8E8',
  divider: '#F0F0F0',
  primary: '#006B6B',
  primaryLight: '#00897B',
  accent: '#7ED957',
  accentBg: 'rgba(126,217,87,0.15)',
  title: '#004D4D',
  body: '#333333',
  label: '#777777',
  tableHeader: '#006B6B',
  tableAltRow: '#F5FAF8',
  tableHover: '#E0F2EF',
  ownBadgeBg: '#00897B',
  ownBadgeText: '#FFFFFF',
  compBadgeBg: '#E0E0E0',
  compBadgeText: '#333333',
  priceUp: '#E57373',
  priceDown: '#66BB6A',
  newItem: '#42A5F5',
  removed: '#FFA726',
  noChange: '#BDBDBD',
};

const cardStyle = { background: T.cardBg, borderRadius: T.cardRadius, boxShadow: T.cardShadow, border: `1px solid ${T.border}` };
const headerBtnStyle = { background: T.cardBg, border: `1px solid ${T.border}`, color: T.primary, borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 6 };
const thStyle = { background: T.tableHeader, color: '#FFFFFF', padding: '12px 16px', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' };
const tdStyle = { padding: '12px 16px', borderBottom: `1px solid ${T.border}` };
const selectStyle = { padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, background: '#FFF', cursor: 'pointer' };

const KpiCard = ({ label, value, color, icon: Icon }) => (
  <div style={{ ...cardStyle, borderLeft: `4px solid ${color}`, padding: '16px 20px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {Icon && <Icon size={18} color={color} />}
      <div style={{ color, fontSize: '28px', fontWeight: 700 }}>{value}</div>
    </div>
    <div style={{ color: T.label, fontSize: '13px', marginTop: 4 }}>{label}</div>
  </div>
);

const Badge = ({ text, bg, color }) => (
  <span style={{ display: 'inline-block', fontSize: 11, padding: '2px 10px', borderRadius: 12, fontWeight: 600, background: bg, color }}>{text}</span>
);

const TierBar = ({ tier, count, maxCount, color }) => {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={{ width: 100, fontSize: 12, color: T.label, textAlign: 'right' }}>{tier}</div>
      <div style={{ flex: 1, height: 20, background: T.divider, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
        {count > 0 && (
          <span style={{ position: 'absolute', left: `${Math.min(pct, 90)}%`, top: '50%', transform: 'translateY(-50%)', marginLeft: 6, fontSize: 11, fontWeight: 600, color: T.body }}>{count}</span>
        )}
      </div>
    </div>
  );
};

const BrandAiBullets = ({ bullets }) => {
  if (!bullets || bullets.length === 0) return null;
  return (
    <div style={{ marginTop: 14, padding: '14px 16px', background: 'linear-gradient(135deg, rgba(126,217,87,0.06) 0%, rgba(0,107,107,0.06) 100%)', borderRadius: 10, borderLeft: `3px solid ${T.accent}` }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        <Sparkles size={13} color={T.accent} /> AI Recommendation
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {bullets.map((bullet, bIdx) => (
          <div key={bIdx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: T.body, lineHeight: 1.5 }}>
            <span style={{ color: T.primary, fontWeight: 700, marginTop: 1, flexShrink: 0 }}>&#x203A;</span>
            <span>{bullet}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const DiscountBadge = ({ pct, flag }) => {
  if (pct == null && (!flag || flag === 'unknown')) return <span style={{ fontSize: 11, color: T.label }}>N/A</span>;
  const val = pct != null ? Math.round(pct) : null;
  let bg, color, label;
  if (flag === 'weak_value' || (val != null && val < 10)) {
    bg = 'rgba(229,115,115,0.15)'; color = T.priceUp; label = val != null ? `${val}% off` : 'Weak';
  } else if (flag === 'aggressive' || (val != null && val > 30)) {
    bg = 'rgba(255,152,0,0.15)'; color = '#E65100'; label = val != null ? `${val}% off` : 'Aggressive';
  } else if (val != null && val >= 10) {
    bg = 'rgba(102,187,106,0.15)'; color = T.priceDown; label = `${val}% off`;
  } else {
    bg = T.accentBg; color = T.primary; label = flag || 'N/A';
  }
  return <Badge text={label} bg={bg} color={color} />;
};

const PriorityBadge = ({ priority }) => {
  const styles = {
    P1: { bg: 'rgba(229,115,115,0.15)', color: T.priceUp },
    P2: { bg: 'rgba(255,167,38,0.15)', color: T.removed },
    P3: { bg: 'rgba(189,189,189,0.15)', color: T.label },
  };
  const s = styles[priority] || styles.P3;
  return <Badge text={priority} bg={s.bg} color={s.color} />;
};

const ComboAiAnalysis = ({ analysis }) => {
  if (!analysis) return null;
  const { own_brand_combos, combo_type_gaps, pricing_gaps, summary } = analysis;

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {summary && (
        <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, rgba(126,217,87,0.06) 0%, rgba(0,107,107,0.06) 100%)', borderRadius: 10, borderLeft: `3px solid ${T.accent}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <Sparkles size={13} color={T.accent} /> Executive Summary
          </div>
          <div style={{ fontSize: 13, color: T.body, lineHeight: 1.6 }}>{summary}</div>
        </div>
      )}

      {own_brand_combos && own_brand_combos.length > 0 && (
        <div style={{ padding: '14px 16px', background: T.tableAltRow, borderRadius: 10, border: `1px solid ${T.divider}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <DollarSign size={13} color={T.primary} /> Value Analysis
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', padding: '8px 12px', fontSize: 11 }}>COMBO</th>
                  <th style={{ ...thStyle, textAlign: 'right', padding: '8px 12px', fontSize: 11 }}>PRICE</th>
                  <th style={{ ...thStyle, textAlign: 'right', padding: '8px 12px', fontSize: 11 }}>STANDALONE</th>
                  <th style={{ ...thStyle, textAlign: 'center', padding: '8px 12px', fontSize: 11 }}>DISCOUNT</th>
                </tr>
              </thead>
              <tbody>
                {own_brand_combos.map((c, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                    <td style={{ ...tdStyle, padding: '8px 12px', maxWidth: 220 }}>
                      <div style={{ fontWeight: 500 }}>{c.name}</div>
                      {c.components_parsed && c.components_parsed.length > 0 && (
                        <div style={{ fontSize: 11, color: T.label, marginTop: 2 }}>{c.components_parsed.join(' + ')}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: T.primary }}>{c.price} AED</td>
                    <td style={{ ...tdStyle, textAlign: 'right', padding: '8px 12px', color: T.label }}>
                      {c.estimated_standalone_total != null ? `${c.estimated_standalone_total} AED` : '-'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px' }}>
                      <DiscountBadge pct={c.discount_pct} flag={c.value_flag} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {combo_type_gaps && combo_type_gaps.length > 0 && (
        <div style={{ padding: '14px 16px', background: 'rgba(255,167,38,0.04)', borderRadius: 10, border: '1px solid rgba(255,167,38,0.15)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.removed, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <AlertTriangle size={13} /> Combo Type Gaps
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {combo_type_gaps.map((gap, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', background: '#FFF', borderRadius: 8, border: `1px solid ${T.divider}` }}>
                <PriorityBadge priority={gap.priority} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: T.body }}>{gap.gap_type}</div>
                  <div style={{ fontSize: 12, color: T.label, marginTop: 3 }}>{gap.recommendation}</div>
                  {gap.suggested_price > 0 && (
                    <div style={{ fontSize: 12, color: T.primary, marginTop: 3, fontWeight: 500 }}>
                      Suggested: ~{gap.suggested_price} AED
                      {gap.suggested_discount_pct > 0 && ` (${Math.round(gap.suggested_discount_pct)}% discount)`}
                    </div>
                  )}
                  {gap.competitors_offering && gap.competitors_offering.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                      {gap.competitors_offering.map((comp, ci) => (
                        <Badge key={ci} text={comp} bg={T.compBadgeBg} color={T.compBadgeText} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pricing_gaps && pricing_gaps.length > 0 && (
        <div style={{ padding: '14px 16px', background: T.tableAltRow, borderRadius: 10, border: `1px solid ${T.divider}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.primary, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <TrendingUp size={13} /> Price Comparisons
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', padding: '8px 12px', fontSize: 11 }}>YOUR COMBO</th>
                  <th style={{ ...thStyle, textAlign: 'right', padding: '8px 12px', fontSize: 11 }}>YOUR PRICE</th>
                  <th style={{ ...thStyle, textAlign: 'left', padding: '8px 12px', fontSize: 11 }}>COMPETITOR</th>
                  <th style={{ ...thStyle, textAlign: 'right', padding: '8px 12px', fontSize: 11 }}>THEIR PRICE</th>
                  <th style={{ ...thStyle, textAlign: 'center', padding: '8px 12px', fontSize: 11 }}>DIFF</th>
                  <th style={{ ...thStyle, textAlign: 'left', padding: '8px 12px', fontSize: 11 }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {pricing_gaps.map((pg, i) => {
                  const diffColor = pg.price_diff_pct > 0 ? T.priceUp : T.priceDown;
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                      <td style={{ ...tdStyle, padding: '8px 12px', fontWeight: 500 }}>{pg.own_combo}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', padding: '8px 12px', fontWeight: 600, color: T.primary }}>{pg.own_price} AED</td>
                      <td style={{ ...tdStyle, padding: '8px 12px' }}>
                        <div style={{ fontSize: 12, color: T.label }}>{pg.competitor}</div>
                        <div style={{ fontWeight: 500 }}>{pg.competitor_combo}</div>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', padding: '8px 12px', fontWeight: 600 }}>{pg.competitor_price} AED</td>
                      <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px' }}>
                        <span style={{ color: diffColor, fontWeight: 600 }}>{pg.price_diff_pct > 0 ? '+' : ''}{Math.round(pg.price_diff_pct)}%</span>
                      </td>
                      <td style={{ ...tdStyle, padding: '8px 12px', fontSize: 12, color: T.body }}>{pg.action}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const BrandInsightsCard = ({ title, brandInsights, loading, onRegenerate }) => (
  <div style={{ ...cardStyle, padding: 20, marginBottom: 24 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h3 style={{ margin: 0, color: T.title, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={16} color={T.accent} /> {title}
      </h3>
      <button onClick={onRegenerate} disabled={loading} style={{ ...headerBtnStyle, fontSize: 12, padding: '6px 12px' }}>
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? 'Generating...' : 'Regenerate'}
      </button>
    </div>
    {loading && !brandInsights ? (
      <div style={{ color: T.label, fontSize: 14, padding: '12px 0' }}>Generating AI insights...</div>
    ) : brandInsights && brandInsights.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {brandInsights.map((bi, idx) => (
          <div key={idx} style={{ padding: '14px 16px', background: T.tableAltRow, borderRadius: 10, borderLeft: `3px solid ${T.primary}` }}>
            <div style={{ fontWeight: 700, color: T.title, fontSize: 14, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: T.primary }}>&#x2605;</span> {bi.brand}
            </div>
            {bi.bullets && bi.bullets.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {bi.bullets.map((bullet, bIdx) => (
                  <div key={bIdx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: T.body, lineHeight: 1.5 }}>
                    <span style={{ color: T.primary, fontWeight: 700, marginTop: 1, flexShrink: 0 }}>&#x203A;</span>
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
            ) : bi.insight ? (
              <div style={{ color: T.body, fontSize: 13, lineHeight: 1.6 }}>{bi.insight}</div>
            ) : null}
          </div>
        ))}
      </div>
    ) : (
      <div style={{ color: T.label, fontSize: 14 }}>No insights available. Click Regenerate.</div>
    )}
  </div>
);


// ================================================================
// COMBO INSIGHTS VIEW
// ================================================================

export const ComboInsightsView = ({ onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [expandedComboList, setExpandedComboList] = useState(null);
  const [brandFilter, setBrandFilter] = useState('all');

  const loadData = async (date) => {
    setLoading(true);
    try {
      const url = date ? `${API}/combos?scrape_date=${date}` : `${API}/combos`;
      const res = await axios.get(url);
      setData(res.data);
      if (res.data.has_data) loadAi(res.data.scrape_date);
    } catch (err) { toast.error('Error loading combo data'); }
    setLoading(false);
  };

  const loadAi = async (date, force = false) => {
    setAiLoading(true);
    try {
      const res = await axios.get(`${API}/combos/ai?scrape_date=${date}${force ? '&force=true' : ''}`);
      setAiInsights(res.data.insights?.brand_insights || null);
    } catch (err) { console.error('AI insights error:', err); }
    setAiLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: T.label }}>Loading combo insights...</div>;
  if (!data?.has_data) return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
          <Package size={48} color={T.noChange} />
          <p style={{ color: T.label, marginTop: 12 }}>No combo data available.</p>
          <button onClick={onBack} style={{ ...headerBtnStyle, marginTop: 12 }}><X size={14} /> Back</button>
        </div>
      </div>
    </div>
  );

  const tierColors = { '0-19': '#66BB6A', '20-29': '#42A5F5', '30-39': '#FFA726', '40-49': '#E57373', '50+': '#AB47BC' };
  const tierLabels = { '0-19': '0-19 AED', '20-29': '20-29 AED', '30-39': '30-39 AED', '40-49': '40-49 AED', '50+': '50+ AED' };

  const ownBrands = data.groups.map(g => g.own_brand);
  const allCompBrands = [...new Set(data.groups.flatMap(g => g.competitors.map(c => c.brand_name)))];

  const filteredGroups = data.groups.filter(group => {
    if (brandFilter === 'all') return true;
    if (brandFilter === 'only_own') return true;
    if (brandFilter === 'only_comp') return group.competitors.length > 0;
    return group.own_brand === brandFilter || group.competitors.some(c => c.brand_name === brandFilter);
  });

  const filteredTotalCombos = filteredGroups.reduce((sum, g) => {
    if (brandFilter === 'only_own') return sum + g.own_data.combo_count;
    if (brandFilter === 'only_comp') return sum + g.competitors.reduce((s, c) => s + c.combo_count, 0);
    const brands = [g.own_data, ...g.competitors];
    return sum + brands.reduce((s, b) => s + b.combo_count, 0);
  }, 0);
  const filteredGaps = filteredGroups.filter(g => g.price_gaps.length > 0).length;

  const getAiForBrand = (brandName) => {
    if (!aiInsights) return null;
    const match = aiInsights.find(bi => bi.brand && bi.brand.toLowerCase() === brandName.toLowerCase());
    return match || null;
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Target size={20} /> Combo Insights
              </h1>
              <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>
                Combo strategy analysis & price gap identification
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {data.available_dates?.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: T.label, fontWeight: 500 }}>Date:</span>
                  <select value={data.scrape_date} onChange={(e) => loadData(e.target.value)} style={selectStyle}>
                    {[...data.available_dates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: T.label, fontWeight: 500 }}>Brand:</span>
                <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} style={{ ...selectStyle, minWidth: 180 }}>
                  <option value="all">All Brands</option>
                  <option value="only_own">Only Own Brands</option>
                  <option value="only_comp">Only Competitors</option>
                  <optgroup label="Own Brands">
                    {ownBrands.map(b => <option key={`own-${b}`} value={b}>{b}</option>)}
                  </optgroup>
                  <optgroup label="Competitors">
                    {allCompBrands.map(b => <option key={`comp-${b}`} value={b}>{b}</option>)}
                  </optgroup>
                </select>
              </div>
              <button onClick={onBack} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          <KpiCard label="Total Combos Detected" value={filteredTotalCombos} color={T.primary} icon={Package} />
          <KpiCard label="Groups with Price Gaps" value={filteredGaps} color={T.removed} icon={AlertTriangle} />
          <KpiCard label="Brand Groups Shown" value={filteredGroups.length} color={T.newItem} icon={Filter} />
        </div>

        <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color={T.accent} />
            <span style={{ fontSize: 14, fontWeight: 600, color: T.title }}>AI Combo Recommendations</span>
            <span style={{ fontSize: 12, color: T.label }}>&#x2014; shown under each brand group below</span>
          </div>
          <button onClick={() => loadAi(data.scrape_date, true)} disabled={aiLoading} style={{ ...headerBtnStyle, fontSize: 12, padding: '6px 12px' }}>
            <RefreshCw size={12} className={aiLoading ? 'animate-spin' : ''} /> {aiLoading ? 'Generating...' : 'Regenerate All'}
          </button>
        </div>

        {filteredGroups.map((group) => {
          const isExpanded = expandedGroup === group.own_brand;
          const allBrands = [group.own_data, ...group.competitors];
          const brandAi = getAiForBrand(group.own_brand);

          return (
            <div key={group.own_brand} style={{ ...cardStyle, padding: 0, marginBottom: 20, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '18px 20px', background: isExpanded ? T.tableAltRow : T.cardBg, borderBottom: `1px solid ${T.divider}`, transition: 'background 0.2s ease' }}
                onClick={() => setExpandedGroup(isExpanded ? null : group.own_brand)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, color: T.title, fontSize: 17, fontWeight: 700 }}>{group.own_brand}</h3>
                  <Badge text="OWN" bg={T.ownBadgeBg} color={T.ownBadgeText} />
                  <span style={{ fontSize: 13, color: T.label }}>
                    {group.own_data.combo_count} combos &middot; avg AED {group.own_data.avg_combo_price}
                  </span>
                  {group.price_gaps.length > 0 && (
                    <Badge text={`${group.price_gaps.length} gaps`} bg="rgba(255,167,38,0.15)" color={T.removed} />
                  )}
                  {group.competitors.length > 0 && (
                    <span style={{ fontSize: 12, color: T.label }}>vs {group.competitors.map(c => c.brand_name).join(', ')}</span>
                  )}
                </div>
                <button style={{ background: isExpanded ? T.primaryLight : '#FFF', border: `1px solid ${isExpanded ? T.primaryLight : T.border}`, color: isExpanded ? '#FFF' : T.primary, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.2s ease', whiteSpace: 'nowrap' }}>
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isExpanded ? 'Hide Details' : 'View Tier Breakdown & Combo List'}
                </button>
              </div>

              <div style={{ padding: 20 }}>
                {brandAi && brandAi.analysis ? (
                  <ComboAiAnalysis analysis={brandAi.analysis} />
                ) : brandAi && brandAi.bullets ? (
                  <BrandAiBullets bullets={brandAi.bullets} />
                ) : null}
                {aiLoading && !brandAi && (
                  <div style={{ padding: '10px 16px', marginTop: 8, background: T.tableAltRow, borderRadius: 8, fontSize: 13, color: T.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={12} className="animate-spin" /> Generating AI insights...
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(allBrands.length, 4)}, 1fr)`, gap: 12, marginTop: brandAi ? 16 : 0 }}>
                  {allBrands.map((b) => {
                    const isOwn = b.brand_name === group.own_brand;
                    const maxTierCount = Math.max(...Object.values(b.tiers).map(t => t.count), 1);
                    return (
                      <div key={b.brand_name} style={{
                        padding: 14, borderRadius: 10,
                        background: isOwn ? T.tableAltRow : '#FAFAFA',
                        border: isOwn ? `2px solid ${T.primaryLight}` : `1px solid ${T.border}`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <div>
                            <div style={{ fontWeight: 600, color: T.body, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                              {b.brand_name}
                              {isOwn && <Badge text="OWN" bg={T.ownBadgeBg} color={T.ownBadgeText} />}
                              {!isOwn && <Badge text="COMP" bg={T.compBadgeBg} color={T.compBadgeText} />}
                            </div>
                            <div style={{ fontSize: 12, color: T.label, marginTop: 2 }}>{b.combo_count} combos / {b.total_items} items ({b.combo_pct}%)</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, padding: '8px 0', borderBottom: `1px solid ${T.divider}` }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: T.primary }}>{b.avg_combo_price || '\u2014'}</div>
                            <div style={{ fontSize: 11, color: T.label }}>Avg AED</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: T.body }}>{b.min_combo || '\u2014'}</div>
                            <div style={{ fontSize: 11, color: T.label }}>Min</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 700, color: T.body }}>{b.max_combo || '\u2014'}</div>
                            <div style={{ fontSize: 11, color: T.label }}>Max</div>
                          </div>
                        </div>
                        {Object.entries(b.tiers).map(([key, tier]) => (
                          <TierBar key={key} tier={tierLabels[key]} count={tier.count} maxCount={maxTierCount} color={tierColors[key]} />
                        ))}
                      </div>
                    );
                  })}
                </div>

                {group.price_gaps.length > 0 && (
                  <div style={{ marginTop: 16, padding: 14, background: 'rgba(255,167,38,0.08)', borderRadius: 10, border: `1px solid rgba(255,167,38,0.2)` }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.removed, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle size={14} /> Price Gaps Identified
                    </div>
                    {group.price_gaps.map((gap, i) => (
                      <div key={i} style={{ fontSize: 13, color: T.body, padding: '4px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                        <Badge text={gap.type === 'missing' ? 'MISSING' : 'PRICING'} bg={gap.type === 'missing' ? 'rgba(229,115,115,0.15)' : 'rgba(66,165,245,0.15)'} color={gap.type === 'missing' ? T.priceUp : T.newItem} />
                        <span><strong>{gap.tier}</strong> &mdash; {gap.detail}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isExpanded && (
                  <div style={{ marginTop: 20, borderTop: `1px solid ${T.divider}`, paddingTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.title, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Combo Item Details</div>
                    {allBrands.filter(b => b.combo_count > 0).map((brand) => {
                      const isListExpanded = expandedComboList === `${group.own_brand}_${brand.brand_name}`;
                      const listKey = `${group.own_brand}_${brand.brand_name}`;
                      return (
                        <div key={brand.brand_name} style={{ marginBottom: 10 }}>
                          <button onClick={() => setExpandedComboList(isListExpanded ? null : listKey)}
                            style={{ width: '100%', textAlign: 'left', background: isListExpanded ? T.tableAltRow : '#FAFAFA', border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: T.primary, display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.2s ease' }}>
                            {isListExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span style={{ flex: 1 }}>{brand.brand_name}</span>
                            <span style={{ fontSize: 12, color: T.label, fontWeight: 400 }}>{brand.combo_count} combos &middot; AED {brand.min_combo}&ndash;{brand.max_combo}</span>
                          </button>
                          {isListExpanded && (
                            <div style={{ marginTop: 4, maxHeight: 340, overflowY: 'auto', borderRadius: '0 0 8px 8px', border: `1px solid ${T.border}`, borderTop: 'none' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                  <tr>
                                    <th style={{ ...thStyle, textAlign: 'left', padding: '10px 16px' }}>COMBO ITEM</th>
                                    <th style={{ ...thStyle, textAlign: 'center', padding: '10px 16px' }}>CATEGORY</th>
                                    <th style={{ ...thStyle, textAlign: 'right', padding: '10px 16px' }}>PRICE (AED)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {brand.combos.map((c, i) => (
                                    <tr key={i} style={{ background: i % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                                      <td style={{ ...tdStyle, padding: '10px 16px' }}>{c.name}</td>
                                      <td style={{ ...tdStyle, textAlign: 'center', padding: '10px 16px' }}>
                                        {c.category && <Badge text={c.category} bg={T.accentBg} color={T.primary} />}
                                      </td>
                                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: T.primary, padding: '10px 16px' }}>{c.price}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredGroups.length === 0 && (
          <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
            <Filter size={32} color={T.noChange} />
            <p style={{ color: T.label, marginTop: 12, fontSize: 14 }}>No brand groups match the selected filter.</p>
          </div>
        )}
      </div>
    </div>
  );
};


// ================================================================
// MENU GAP ANALYZER VIEW
// ================================================================

export const MenuGapAnalyzerView = ({ onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [brandFilter, setBrandFilter] = useState('all');

  const loadData = async (date) => {
    setLoading(true);
    try {
      const url = date ? `${API}/menu-gaps?scrape_date=${date}` : `${API}/menu-gaps`;
      const res = await axios.get(url);
      setData(res.data);
      if (res.data.has_data) loadAi(res.data.scrape_date);
    } catch (err) { toast.error('Error loading menu gap data'); }
    setLoading(false);
  };

  const loadAi = async (date, force = false) => {
    setAiLoading(true);
    try {
      const res = await axios.get(`${API}/menu-gaps/ai?scrape_date=${date}${force ? '&force=true' : ''}`);
      setAiInsights(res.data.insights?.brand_insights || null);
    } catch (err) { console.error('AI insights error:', err); }
    setAiLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: T.label }}>Loading menu gap analysis...</div>;
  if (!data?.has_data) return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
          <Layers size={48} color={T.noChange} />
          <p style={{ color: T.label, marginTop: 12 }}>No menu data available.</p>
          <button onClick={onBack} style={{ ...headerBtnStyle, marginTop: 12 }}><X size={14} /> Back</button>
        </div>
      </div>
    </div>
  );

  const distColors = { '0-19': '#66BB6A', '20-29': '#42A5F5', '30-39': '#FFA726', '40-49': '#E57373', '50+': '#AB47BC' };

  const ownBrands = data.groups.map(g => g.own_brand);
  const allCompBrands = [...new Set(data.groups.flatMap(g => g.competitors.map(c => c.brand_name)))];

  const filteredGroups = data.groups.filter(group => {
    if (brandFilter === 'all') return true;
    if (brandFilter === 'only_own') return true;
    if (brandFilter === 'only_comp') return group.competitors.length > 0;
    return group.own_brand === brandFilter || group.competitors.some(c => c.brand_name === brandFilter);
  });

  const filteredCatGaps = filteredGroups.reduce((s, g) => s + g.all_missing_categories.length, 0);
  const filteredPriceGaps = filteredGroups.reduce((s, g) => s + g.competitors.reduce((cs, c) => cs + c.price_gaps.length, 0), 0);
  const filteredPromoGaps = filteredGroups.filter(g => g.promo_gap).length;

  const getAiForBrand = (brandName) => {
    if (!aiInsights) return null;
    const match = aiInsights.find(bi => bi.brand && bi.brand.toLowerCase() === brandName.toLowerCase());
    return match?.bullets || null;
  };

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Layers size={20} /> Menu Gap Analyzer
              </h1>
              <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>
                Identify missing categories, price gaps & variety gaps vs competitors
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {data.available_dates?.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: T.label, fontWeight: 500 }}>Date:</span>
                  <select value={data.scrape_date} onChange={(e) => loadData(e.target.value)} style={selectStyle}>
                    {[...data.available_dates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: T.label, fontWeight: 500 }}>Brand:</span>
                <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)} style={{ ...selectStyle, minWidth: 180 }}>
                  <option value="all">All Brands</option>
                  <option value="only_own">Only Own Brands</option>
                  <option value="only_comp">Only Competitors</option>
                  <optgroup label="Own Brands">
                    {ownBrands.map(b => <option key={`own-${b}`} value={b}>{b}</option>)}
                  </optgroup>
                  <optgroup label="Competitors">
                    {allCompBrands.map(b => <option key={`comp-${b}`} value={b}>{b}</option>)}
                  </optgroup>
                </select>
              </div>
              <button onClick={onBack} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          <KpiCard label="Category Gaps Found" value={filteredCatGaps} color={T.priceUp} icon={AlertTriangle} />
          <KpiCard label="Price Range Gaps" value={filteredPriceGaps} color={T.removed} icon={DollarSign} />
          <KpiCard label="Promo / Seasonal Gaps" value={filteredPromoGaps} color="#FF9800" icon={TrendingUp} />
          <KpiCard label="Brand Groups Shown" value={filteredGroups.length} color={T.primary} icon={Layers} />
        </div>

        <div style={{ ...cardStyle, padding: '12px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={16} color={T.accent} />
            <span style={{ fontSize: 14, fontWeight: 600, color: T.title }}>AI Menu Gap Recommendations</span>
            <span style={{ fontSize: 12, color: T.label }}>&#x2014; shown under each brand group below</span>
          </div>
          <button onClick={() => loadAi(data.scrape_date, true)} disabled={aiLoading} style={{ ...headerBtnStyle, fontSize: 12, padding: '6px 12px' }}>
            <RefreshCw size={12} className={aiLoading ? 'animate-spin' : ''} /> {aiLoading ? 'Generating...' : 'Regenerate All'}
          </button>
        </div>

        {filteredGroups.map((group) => {
          const isExpanded = expandedGroup === group.own_brand;
          const hasMissingCats = group.all_missing_categories.length > 0;
          const hasPromoGap = group.promo_gap;
          const hasAnyGaps = hasMissingCats || hasPromoGap || group.competitors.some(c => c.price_gaps.length > 0 || c.depth_gaps.length > 0);
          const brandAi = getAiForBrand(group.own_brand);

          return (
            <div key={group.own_brand} style={{ ...cardStyle, padding: 0, marginBottom: 20, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '18px 20px', background: isExpanded ? T.tableAltRow : T.cardBg, borderBottom: `1px solid ${T.divider}`, transition: 'background 0.2s ease' }}
                onClick={() => setExpandedGroup(isExpanded ? null : group.own_brand)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, color: T.title, fontSize: 17, fontWeight: 700 }}>{group.own_brand}</h3>
                  <Badge text="OWN" bg={T.ownBadgeBg} color={T.ownBadgeText} />
                  <span style={{ fontSize: 13, color: T.label }}>
                    {group.own_total_items} items &middot; {group.own_category_count} categories
                  </span>
                  {hasMissingCats && (
                    <Badge text={`${group.all_missing_categories.length} missing cats`} bg="rgba(229,115,115,0.15)" color={T.priceUp} />
                  )}
                  {hasPromoGap && (
                    <Badge text="Promo gap" bg="rgba(255,152,0,0.15)" color="#E65100" />
                  )}
                  {!hasAnyGaps && <Badge text="No gaps" bg={T.accentBg} color={T.primary} />}
                </div>
                <button style={{ background: isExpanded ? T.primaryLight : '#FFF', border: `1px solid ${isExpanded ? T.primaryLight : T.border}`, color: isExpanded ? '#FFF' : T.primary, borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.2s ease', whiteSpace: 'nowrap' }}>
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {isExpanded ? 'Hide Details' : 'View Competitor Analysis'}
                </button>
              </div>

              <div style={{ padding: 20 }}>
                {brandAi && <BrandAiBullets bullets={brandAi} />}
                {aiLoading && !brandAi && (
                  <div style={{ padding: '10px 16px', marginBottom: 8, background: T.tableAltRow, borderRadius: 8, fontSize: 13, color: T.label, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={12} className="animate-spin" /> Generating AI insights...
                  </div>
                )}

                {hasMissingCats && (
                  <div style={{ marginTop: brandAi ? 14 : 0, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: T.priceUp, fontWeight: 600, paddingTop: 3 }}>Missing:</span>
                    {group.all_missing_categories.map(cat => (
                      <Badge key={cat} text={cat} bg="rgba(229,115,115,0.1)" color={T.priceUp} />
                    ))}
                  </div>
                )}

                {hasPromoGap && group.promo_details && group.promo_details.length > 0 && (
                  <div style={{ marginTop: 12, padding: '12px 16px', background: 'rgba(255,152,0,0.08)', borderRadius: 10, borderLeft: '3px solid #FF9800' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#E65100', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <TrendingUp size={14} /> Competitors running promotions you don't have
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {group.promo_details.map((pd, i) => (
                        <div key={i} style={{ fontSize: 12, color: T.body, lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 600, color: '#E65100' }}>{pd.brand}</span>
                          <span style={{ color: T.label }}> &mdash; {pd.count} promo items: </span>
                          <span style={{ color: T.body }}>{pd.items.join(', ')}{pd.count > pd.items.length ? ` +${pd.count - pd.items.length} more` : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 14, padding: 14, background: T.tableAltRow, borderRadius: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.label, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Price Distribution &mdash; {group.own_brand}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {Object.entries(group.own_price_distribution).map(([range, count]) => {
                      const total = Object.values(group.own_price_distribution).reduce((s, v) => s + v, 0);
                      const pct = total > 0 ? (count / total) * 100 : 0;
                      return (
                        <div key={range} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ height: 60, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginBottom: 4 }}>
                            <div style={{ width: '70%', height: `${Math.max(pct, 3)}%`, background: distColors[range] || T.primary, borderRadius: '4px 4px 0 0', minHeight: count > 0 ? 4 : 0, transition: 'height 0.4s ease' }} />
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: T.body }}>{count}</div>
                          <div style={{ fontSize: 10, color: T.label }}>{range} AED</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: 20, borderTop: `1px solid ${T.divider}`, paddingTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.title, marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Competitor-by-Competitor Analysis</div>
                    {group.competitors.map((comp) => (
                      <div key={comp.brand_name} style={{ padding: 16, background: '#FAFAFA', borderRadius: 10, border: `1px solid ${T.border}`, marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: T.body }}>vs {comp.brand_name}</h4>
                          <Badge text="COMP" bg={T.compBadgeBg} color={T.compBadgeText} />
                          <span style={{ fontSize: 12, color: T.label }}>{comp.total_items} items</span>
                        </div>

                        {comp.missing_categories.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: T.priceUp, marginBottom: 6 }}>Categories you're missing:</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr>
                                  <th style={{ ...thStyle, textAlign: 'left', padding: '8px 12px' }}>CATEGORY</th>
                                  <th style={{ ...thStyle, textAlign: 'center', padding: '8px 12px' }}>COMP ITEMS</th>
                                  <th style={{ ...thStyle, textAlign: 'center', padding: '8px 12px' }}>AVG PRICE</th>
                                  <th style={{ ...thStyle, textAlign: 'center', padding: '8px 12px' }}>RANGE</th>
                                </tr>
                              </thead>
                              <tbody>
                                {comp.missing_categories.map((mc, i) => (
                                  <tr key={i} style={{ background: i % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                                    <td style={{ ...tdStyle, fontWeight: 600 }}>{mc.category}</td>
                                    <td style={{ ...tdStyle, textAlign: 'center' }}>{mc.comp_count}</td>
                                    <td style={{ ...tdStyle, textAlign: 'center', color: T.primary, fontWeight: 600 }}>AED {mc.comp_avg_price}</td>
                                    <td style={{ ...tdStyle, textAlign: 'center' }}>{mc.comp_price_range} AED</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {comp.depth_gaps.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: T.removed, marginBottom: 6 }}>Variety gaps (competitor has more items):</div>
                            {comp.depth_gaps.map((dg, i) => (
                              <div key={i} style={{ fontSize: 13, color: T.body, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Badge text={dg.category} bg={T.accentBg} color={T.primary} />
                                <span>You have <strong>{dg.own_count}</strong> items vs their <strong>{dg.comp_count}</strong></span>
                                <span style={{ color: T.label }}>(avg AED {dg.comp_avg_price})</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {comp.price_gaps.length > 0 && (
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: T.newItem, marginBottom: 6 }}>Price range gaps:</div>
                            {comp.price_gaps.map((pg, i) => (
                              <div key={i} style={{ fontSize: 13, color: T.body, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Badge text={`${pg.range} AED`} bg="rgba(66,165,245,0.15)" color={T.newItem} />
                                <Badge text={pg.type.toUpperCase()} bg={pg.type === 'missing' ? 'rgba(229,115,115,0.15)' : 'rgba(255,167,38,0.15)'} color={pg.type === 'missing' ? T.priceUp : T.removed} />
                                <span>{pg.detail}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {comp.missing_categories.length === 0 && comp.depth_gaps.length === 0 && comp.price_gaps.length === 0 && (
                          <div style={{ fontSize: 13, color: T.priceDown, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                            &#x2713; No significant gaps vs this competitor
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredGroups.length === 0 && (
          <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
            <Filter size={32} color={T.noChange} />
            <p style={{ color: T.label, marginTop: 12, fontSize: 14 }}>No brand groups match the selected filter.</p>
          </div>
        )}
      </div>
    </div>
  );
};
