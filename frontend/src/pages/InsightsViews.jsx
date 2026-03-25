import React, { useState, useEffect, useMemo } from 'react';
import { X, RefreshCw, Sparkles, Package, TrendingUp, ChevronDown, ChevronRight, AlertTriangle, Target, Layers, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API = '/api/insights';

// ── Theme matching Dashboard.js exactly ──
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

const AiSummaryCard = ({ title, summary, loading, onRegenerate }) => (
  <div style={{ ...cardStyle, padding: 20, marginBottom: 24 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <h3 style={{ margin: 0, color: T.title, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={16} color={T.accent} /> {title}
      </h3>
      <button onClick={onRegenerate} disabled={loading} style={{ ...headerBtnStyle, fontSize: 12, padding: '6px 12px' }}>
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {loading ? 'Generating...' : 'Regenerate'}
      </button>
    </div>
    {loading && !summary ? (
      <div style={{ color: T.label, fontSize: 14, padding: '12px 0' }}>Generating AI insights...</div>
    ) : summary ? (
      <div style={{ color: T.body, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{summary}</div>
    ) : (
      <div style={{ color: T.label, fontSize: 14 }}>No insights available. Click Regenerate.</div>
    )}
  </div>
);

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
            <div style={{ fontWeight: 700, color: T.title, fontSize: 14, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: T.primary }}>★</span> {bi.brand}
            </div>
            <div style={{ color: T.body, fontSize: 13, lineHeight: 1.6 }}>{bi.insight}</div>
          </div>
        ))}
      </div>
    ) : (
      <div style={{ color: T.label, fontSize: 14 }}>No insights available. Click Regenerate.</div>
    )}
  </div>
);


// ═══════════════════════════════════════════════════════════
// COMBO INSIGHTS VIEW
// ═══════════════════════════════════════════════════════════

export const ComboInsightsView = ({ onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null);
  const [expandedComboList, setExpandedComboList] = useState(null);

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

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Target size={20} /> Combo Insights
              </h1>
              <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>
                Combo strategy analysis & price gap identification · {data.scrape_date}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {data.available_dates?.length > 1 && (
                <select value={data.scrape_date} onChange={(e) => loadData(e.target.value)}
                  style={{ padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, background: '#FFF', cursor: 'pointer' }}>
                  {[...data.available_dates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <button onClick={onBack} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          <KpiCard label="Total Combos Detected" value={data.summary.total_combos} color={T.primary} icon={Package} />
          <KpiCard label="Groups with Price Gaps" value={data.summary.groups_with_gaps} color={T.removed} icon={AlertTriangle} />
          <KpiCard label="Total Menu Items" value={data.summary.total_items} color={T.newItem} icon={Layers} />
        </div>

        {/* AI Insights — Brand by Brand */}
        <BrandInsightsCard
          title="AI Combo Recommendations"
          brandInsights={aiInsights}
          loading={aiLoading}
          onRegenerate={() => loadAi(data.scrape_date, true)}
        />

        {/* Groups */}
        {data.groups.map((group) => {
          const isExpanded = expandedGroup === group.own_brand;
          const allBrands = [group.own_data, ...group.competitors];
          const maxCombo = Math.max(...allBrands.map(b => b.combo_count), 1);

          return (
            <div key={group.own_brand} style={{ ...cardStyle, padding: 20, marginBottom: 16 }}>
              {/* Group header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setExpandedGroup(isExpanded ? null : group.own_brand)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, color: T.title, fontSize: 16, fontWeight: 600 }}>{group.own_brand}</h3>
                  <Badge text="OWN" bg={T.ownBadgeBg} color={T.ownBadgeText} />
                  <span style={{ fontSize: 13, color: T.label }}>
                    {group.own_data.combo_count} combos · avg AED {group.own_data.avg_combo_price}
                  </span>
                  {group.price_gaps.length > 0 && (
                    <Badge text={`${group.price_gaps.length} gaps`} bg="rgba(255,167,38,0.15)" color={T.removed} />
                  )}
                </div>
                {isExpanded ? <ChevronDown size={18} color={T.label} /> : <ChevronRight size={18} color={T.label} />}
              </div>

              {/* Compact tier comparison — always visible */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${allBrands.length}, 1fr)`, gap: 12, marginTop: 16 }}>
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
                          <div style={{ fontWeight: 600, color: T.body, fontSize: 14 }}>{b.brand_name}</div>
                          <div style={{ fontSize: 12, color: T.label }}>{b.combo_count} combos / {b.total_items} items ({b.combo_pct}%)</div>
                        </div>
                        {isOwn && <span style={{ color: T.primary, fontSize: 11, fontWeight: 700 }}>★</span>}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, padding: '8px 0', borderBottom: `1px solid ${T.divider}` }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: T.primary }}>{b.avg_combo_price || '—'}</div>
                          <div style={{ fontSize: 11, color: T.label }}>Avg AED</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: T.body }}>{b.min_combo || '—'}</div>
                          <div style={{ fontSize: 11, color: T.label }}>Min</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: T.body }}>{b.max_combo || '—'}</div>
                          <div style={{ fontSize: 11, color: T.label }}>Max</div>
                        </div>
                      </div>
                      {/* Tier breakdown */}
                      {Object.entries(b.tiers).map(([key, tier]) => (
                        <TierBar key={key} tier={tierLabels[key]} count={tier.count} maxCount={maxTierCount} color={tierColors[key]} />
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Price Gaps */}
              {group.price_gaps.length > 0 && (
                <div style={{ marginTop: 16, padding: 14, background: 'rgba(255,167,38,0.08)', borderRadius: 10, border: `1px solid rgba(255,167,38,0.2)` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.removed, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} /> Price Gaps Identified
                  </div>
                  {group.price_gaps.map((gap, i) => (
                    <div key={i} style={{ fontSize: 13, color: T.body, padding: '4px 0', display: 'flex', gap: 8 }}>
                      <Badge text={gap.type === 'missing' ? 'MISSING' : 'FEWER'} bg={gap.type === 'missing' ? 'rgba(229,115,115,0.15)' : 'rgba(255,167,38,0.15)'} color={gap.type === 'missing' ? T.priceUp : T.removed} />
                      <span><strong>{gap.tier}</strong> — {gap.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Expanded: combo item lists */}
              {isExpanded && (
                <div style={{ marginTop: 16 }}>
                  {allBrands.filter(b => b.combo_count > 0).map((brand) => (
                    <div key={brand.brand_name} style={{ marginBottom: 12 }}>
                      <button onClick={() => setExpandedComboList(expandedComboList === brand.brand_name ? null : brand.brand_name)}
                        style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: T.primary, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {expandedComboList === brand.brand_name ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {brand.brand_name} — {brand.combo_count} combos (AED {brand.min_combo}–{brand.max_combo})
                      </button>
                      {expandedComboList === brand.brand_name && (
                        <div style={{ marginTop: 8, maxHeight: 300, overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ ...thStyle, textAlign: 'left' }}>COMBO ITEM</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>CATEGORY</th>
                                <th style={{ ...thStyle, textAlign: 'right' }}>PRICE (AED)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {brand.combos.map((c, i) => (
                                <tr key={i} style={{ background: i % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                                  <td style={tdStyle}>{c.name}</td>
                                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                                    {c.category && <Badge text={c.category} bg={T.accentBg} color={T.primary} />}
                                  </td>
                                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, color: T.primary }}>{c.price}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════
// MENU GAP ANALYZER VIEW
// ═══════════════════════════════════════════════════════════

export const MenuGapAnalyzerView = ({ onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aiInsights, setAiInsights] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState(null);

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

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Layers size={20} /> Menu Gap Analyzer
              </h1>
              <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>
                Identify missing categories, price gaps & variety gaps vs competitors · {data.scrape_date}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {data.available_dates?.length > 1 && (
                <select value={data.scrape_date} onChange={(e) => loadData(e.target.value)}
                  style={{ padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, background: '#FFF', cursor: 'pointer' }}>
                  {[...data.available_dates].reverse().map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <button onClick={onBack} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          <KpiCard label="Category Gaps Found" value={data.summary.total_category_gaps} color={T.priceUp} icon={AlertTriangle} />
          <KpiCard label="Price Range Gaps" value={data.summary.total_price_gaps} color={T.removed} icon={DollarSign} />
          <KpiCard label="Brand Groups Analyzed" value={data.summary.groups_analyzed} color={T.primary} icon={Layers} />
        </div>

        {/* AI Insights — Brand by Brand */}
        <BrandInsightsCard
          title="AI Menu Gap Recommendations"
          brandInsights={aiInsights}
          loading={aiLoading}
          onRegenerate={() => loadAi(data.scrape_date, true)}
        />

        {/* Groups */}
        {data.groups.map((group) => {
          const isExpanded = expandedGroup === group.own_brand;
          const hasMissingCats = group.all_missing_categories.length > 0;
          const hasAnyGaps = hasMissingCats || group.competitors.some(c => c.price_gaps.length > 0 || c.depth_gaps.length > 0);

          return (
            <div key={group.own_brand} style={{ ...cardStyle, padding: 20, marginBottom: 16 }}>
              {/* Group header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setExpandedGroup(isExpanded ? null : group.own_brand)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: T.primary, marginRight: 4 }}>★</span>
                  <h3 style={{ margin: 0, color: T.title, fontSize: 16, fontWeight: 600 }}>{group.own_brand}</h3>
                  <Badge text="OWN" bg={T.ownBadgeBg} color={T.ownBadgeText} />
                  <span style={{ fontSize: 13, color: T.label }}>
                    {group.own_total_items} items · {group.own_category_count} categories
                  </span>
                  {hasMissingCats && (
                    <Badge text={`${group.all_missing_categories.length} missing cats`} bg="rgba(229,115,115,0.15)" color={T.priceUp} />
                  )}
                  {!hasAnyGaps && <Badge text="No gaps" bg={T.accentBg} color={T.primary} />}
                </div>
                {isExpanded ? <ChevronDown size={18} color={T.label} /> : <ChevronRight size={18} color={T.label} />}
              </div>

              {/* Missing categories — always visible if any */}
              {hasMissingCats && (
                <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: T.priceUp, fontWeight: 600, paddingTop: 3 }}>Missing:</span>
                  {group.all_missing_categories.map(cat => (
                    <Badge key={cat} text={cat} bg="rgba(229,115,115,0.1)" color={T.priceUp} />
                  ))}
                </div>
              )}

              {/* Own brand price distribution — always visible */}
              <div style={{ marginTop: 14, padding: 14, background: T.tableAltRow, borderRadius: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.label, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Price Distribution — {group.own_brand}
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

              {/* Expanded: competitor-by-competitor analysis */}
              {isExpanded && (
                <div style={{ marginTop: 16 }}>
                  {group.competitors.map((comp) => (
                    <div key={comp.brand_name} style={{ padding: 16, background: '#FAFAFA', borderRadius: 10, border: `1px solid ${T.border}`, marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: T.body }}>vs {comp.brand_name}</h4>
                        <Badge text="COMP" bg={T.compBadgeBg} color={T.compBadgeText} />
                        <span style={{ fontSize: 12, color: T.label }}>{comp.total_items} items</span>
                      </div>

                      {/* Missing categories from this competitor */}
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

                      {/* Depth gaps */}
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

                      {/* Price range gaps */}
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
                          ✓ No significant gaps vs this competitor
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
