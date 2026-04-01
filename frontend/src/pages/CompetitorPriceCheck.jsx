import React, { useState, useEffect, useMemo } from 'react';
import { X, RefreshCw, Sparkles, Search, ArrowUpRight, ArrowDownRight, DollarSign, ChevronDown, ChevronRight, Package, Zap, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';

const API = '/api/competitor';

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
  priceUp: '#E57373',
  priceDown: '#66BB6A',
  noChange: '#BDBDBD',
  ownBadgeBg: '#00897B',
  ownBadgeText: '#FFFFFF',
  compBadgeBg: '#E0E0E0',
  compBadgeText: '#333333',
};

const cardStyle = { background: T.cardBg, borderRadius: T.cardRadius, boxShadow: T.cardShadow, border: `1px solid ${T.border}` };
const headerBtnStyle = { background: T.cardBg, border: `1px solid ${T.border}`, color: T.primary, borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 6 };
const headerBtnAccent = { ...headerBtnStyle, background: T.primary, color: '#FFF', border: `1px solid ${T.primary}` };
const selectStyle = { padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, background: '#FFF', cursor: 'pointer' };

const PriceCellBadge = ({ diff, pct }) => {
  if (diff === undefined || diff === null) return <span style={{ color: T.noChange, fontSize: 12 }}>—</span>;
  if (diff === 0) return <span style={{ fontSize: 12, color: T.noChange, fontWeight: 600 }}>Same</span>;
  const isHigher = diff > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, fontWeight: 600,
      color: isHigher ? T.priceDown : T.priceUp,
    }}>
      {isHigher ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
};

const StatCard = ({ label, value, subtext, color }) => (
  <div style={{ ...cardStyle, padding: '16px 20px', flex: 1, minWidth: 140 }}>
    <div style={{ fontSize: 11, color: T.label, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: color || T.title }}>{value}</div>
    {subtext && <div style={{ fontSize: 11, color: T.label, marginTop: 2 }}>{subtext}</div>}
  </div>
);

const ExpandedRowDetail = ({ item, matches, selectedBrand, onLoadAnalysis, analysis, analysisLoading }) => (
  <tr>
    <td colSpan={100} style={{ padding: 0, background: T.tableAltRow, borderBottom: `2px solid ${T.primary}` }}>
      <div style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-start' }}>
          {item.image_url ? (
            <img src={item.image_url} alt={item.item_name} style={{ width: 80, height: 80, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
              onError={(e) => { e.target.style.display = 'none'; }} />
          ) : (
            <div style={{ width: 80, height: 80, borderRadius: 10, background: T.divider, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Package size={28} color={T.noChange} />
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, fontWeight: 600, background: T.ownBadgeBg, color: T.ownBadgeText }}>{selectedBrand}</span>
              {item.category && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: T.accentBg, color: T.primary, fontWeight: 500 }}>{item.category}</span>}
            </div>
            <div style={{ fontWeight: 700, color: T.title, fontSize: 16, marginBottom: 4 }}>{item.item_name}</div>
            <div style={{ fontWeight: 700, color: T.primary, fontSize: 18 }}>AED {item.price?.toFixed(2)}</div>
            {item.description && <div style={{ color: T.label, fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{item.description}</div>}
          </div>
        </div>

        {matches.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: T.title, marginBottom: 8 }}>Competitor Matches</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
              {matches.map((m, idx) => (
                <div key={idx} style={{
                  ...cardStyle, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start',
                  borderLeft: `3px solid ${m.price_diff > 0 ? T.priceDown : m.price_diff < 0 ? T.priceUp : T.noChange}`
                }}>
                  {m.image_url ? (
                    <img src={m.image_url} alt={m.item_name} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
                      onError={(e) => { e.target.style.display = 'none'; }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: 8, background: T.divider, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Package size={16} color={T.noChange} />
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: T.compBadgeBg, color: T.compBadgeText, fontWeight: 600, display: 'inline-block', marginBottom: 3 }}>{m.competitor_brand}</div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: T.body, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.item_name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, color: T.primary, fontSize: 14 }}>AED {m.price?.toFixed(2)}</span>
                      <PriceCellBadge diff={m.price_diff} pct={m.price_diff_pct} />
                      <span style={{ fontSize: 10, color: T.label }}>({Math.round(m.match_confidence * 100)}% match)</span>
                    </div>
                    {m.description && <div style={{ color: T.label, fontSize: 11, lineHeight: 1.3, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{m.description}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {matches.length > 0 && (
          <div style={{ ...cardStyle, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.title, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} color={T.accent} /> AI Pricing Analysis
              </div>
              <button onClick={() => onLoadAnalysis(item, matches, !!analysis)} disabled={analysisLoading}
                style={{ ...headerBtnStyle, fontSize: 11, padding: '4px 10px' }}>
                <RefreshCw size={10} className={analysisLoading ? 'animate-spin' : ''} />
                {analysisLoading ? 'Analyzing...' : analysis ? 'Refresh' : 'Generate'}
              </button>
            </div>
            {analysisLoading && !analysis ? (
              <div style={{ color: T.label, fontSize: 13 }}>Generating analysis...</div>
            ) : analysis ? (
              <div style={{ fontSize: 13, color: T.body, lineHeight: 1.6, whiteSpace: 'pre-wrap', padding: '10px 14px', background: 'rgba(126,217,87,0.05)', borderRadius: 8, borderLeft: `3px solid ${T.accent}` }}>
                {analysis}
              </div>
            ) : (
              <div style={{ color: T.label, fontSize: 12 }}>Click Generate to get AI pricing insights.</div>
            )}
          </div>
        )}
      </div>
    </td>
  </tr>
);

export const CompetitorPriceCheckView = ({ onBack, country = 'UAE' }) => {
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [matrixData, setMatrixData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItem, setExpandedItem] = useState(null);
  const [analyses, setAnalyses] = useState({});
  const [analysisLoadingItem, setAnalysisLoadingItem] = useState(null);

  useEffect(() => { loadBrands(); }, [country]);

  const loadBrands = async () => {
    try {
      const res = await axios.get(`${API}/brands?country=${country}`);
      setBrands(res.data.brands || []);
      if (res.data.brands?.length > 0) {
        const first = res.data.brands[0].own_brand;
        setSelectedBrand(first);
        loadMatrix(first);
      }
    } catch (err) { toast.error('Error loading brands'); }
  };

  const loadMatrix = async (brand) => {
    setLoading(true);
    setMatrixData(null);
    setExpandedItem(null);
    setAnalyses({});
    try {
      const res = await axios.get(`${API}/bulk-match/${encodeURIComponent(brand)}?country=${country}`);
      setMatrixData(res.data);
    } catch (err) { toast.error('Error loading competitor data'); }
    setLoading(false);
  };

  const handleBrandChange = (brand) => {
    setSelectedBrand(brand);
    setSearchQuery('');
    loadMatrix(brand);
  };

  const loadAnalysis = async (item, matches, force = false) => {
    setAnalysisLoadingItem(item.item_name);
    try {
      const res = await axios.post(`${API}/analyze`, {
        own_item: item,
        matches: matches,
        own_brand: selectedBrand,
        force: force,
      });
      setAnalyses(prev => ({ ...prev, [item.item_name]: res.data.analysis }));
    } catch (err) { console.error('Error loading analysis:', err); }
    setAnalysisLoadingItem(null);
  };

  const { groupedItems, competitors, stats } = useMemo(() => {
    if (!matrixData) return { groupedItems: [], competitors: [], stats: {} };

    const comps = matrixData.competitors || [];
    let items = matrixData.items || [];
    const matches = matrixData.matches || {};

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => i.item_name.toLowerCase().includes(q) || (i.category && i.category.toLowerCase().includes(q)));
    }

    const groups = {};
    items.forEach(item => {
      const cat = item.category || 'Uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });

    const grouped = Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));

    let totalMatched = 0, cheaper = 0, pricier = 0, same = 0, totalDiffSum = 0, totalDiffCount = 0;
    (matrixData.items || []).forEach(item => {
      const m = matches[item.item_name] || [];
      if (m.length > 0) {
        totalMatched++;
        m.forEach(match => {
          totalDiffCount++;
          totalDiffSum += match.price_diff || 0;
          if (match.price_diff > 0) cheaper++;
          else if (match.price_diff < 0) pricier++;
          else same++;
        });
      }
    });

    return {
      groupedItems: grouped,
      competitors: comps,
      stats: {
        totalItems: (matrixData.items || []).length,
        matched: totalMatched,
        unmatched: (matrixData.items || []).length - totalMatched,
        cheaper, pricier, same,
        avgDiff: totalDiffCount > 0 ? (totalDiffSum / totalDiffCount) : 0,
        cheaperPct: totalDiffCount > 0 ? Math.round(cheaper / totalDiffCount * 100) : 0,
        pricierPct: totalDiffCount > 0 ? Math.round(pricier / totalDiffCount * 100) : 0,
      }
    };
  }, [matrixData, searchQuery]);

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1600, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={20} /> Competitor Price Check
              </h1>
              <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>
                Executive pricing matrix — compare your full menu against competitors
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: T.label, fontWeight: 500 }}>Brand:</span>
              <select value={selectedBrand} onChange={(e) => handleBrandChange(e.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
                {brands.map(b => <option key={b.own_brand} value={b.own_brand}>{b.own_brand}</option>)}
              </select>
              <button onClick={() => loadMatrix(selectedBrand)} disabled={loading} style={headerBtnAccent}>
                <Zap size={14} /> {loading ? 'Matching...' : 'Match All'}
              </button>
              <button onClick={onBack} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
          </div>
        </div>

        {loading && (
          <div style={{ ...cardStyle, padding: 60, textAlign: 'center', marginBottom: 24 }}>
            <RefreshCw size={32} color={T.primary} className="animate-spin" />
            <p style={{ color: T.label, marginTop: 12, fontSize: 14 }}>Matching all items against competitors... This may take a moment.</p>
            <p style={{ color: T.label, fontSize: 12 }}>Cached matches load instantly. New items are matched via AI.</p>
          </div>
        )}

        {matrixData && !loading && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              <StatCard label="Menu Items" value={stats.totalItems} subtext={`${stats.matched} matched`} color={T.primary} />
              <StatCard label="You're Cheaper" value={`${stats.cheaperPct}%`} subtext={`${stats.cheaper} comparisons`} color={T.priceDown} />
              <StatCard label="You're Pricier" value={`${stats.pricierPct}%`} subtext={`${stats.pricier} comparisons`} color={T.priceUp} />
              <StatCard label="Avg Price Gap" value={`AED ${Math.abs(stats.avgDiff).toFixed(1)}`}
                subtext={stats.avgDiff > 0 ? 'Competitors higher' : stats.avgDiff < 0 ? 'Competitors lower' : 'At parity'}
                color={stats.avgDiff > 0 ? T.priceDown : stats.avgDiff < 0 ? T.priceUp : T.body} />
              <StatCard label="No Match" value={stats.unmatched} subtext="unique items" color={T.noChange} />
            </div>

            <div style={{ ...cardStyle, padding: 16, marginBottom: 24 }}>
              <div style={{ position: 'relative', maxWidth: 400 }}>
                <Search size={16} color={T.label} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input type="text" placeholder="Search items or categories..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px 8px 32px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, outline: 'none', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ ...cardStyle, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={{ background: T.tableHeader, color: '#FFF', padding: '12px 16px', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left', position: 'sticky', left: 0, zIndex: 2, minWidth: 280 }}>
                        Item
                      </th>
                      <th style={{ background: T.tableHeader, color: '#FFF', padding: '12px 16px', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', minWidth: 100 }}>
                        Your Price
                      </th>
                      {competitors.map(comp => (
                        <th key={comp} style={{ background: T.tableHeader, color: '#FFF', padding: '12px 16px', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center', minWidth: 130 }}>
                          {comp}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedItems.map(([category, items]) => (
                      <React.Fragment key={category}>
                        <tr>
                          <td colSpan={2 + competitors.length} style={{
                            padding: '10px 16px', background: 'rgba(0,107,107,0.06)', fontWeight: 700, fontSize: 13, color: T.primary,
                            borderBottom: `1px solid ${T.border}`, borderTop: `2px solid ${T.border}`
                          }}>
                            <BarChart3 size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                            {category}
                            <span style={{ fontWeight: 400, color: T.label, fontSize: 11, marginLeft: 8 }}>({items.length} items)</span>
                          </td>
                        </tr>
                        {items.map((item, idx) => {
                          const itemMatches = matrixData.matches?.[item.item_name] || [];
                          const matchByComp = {};
                          itemMatches.forEach(m => { matchByComp[m.competitor_brand] = m; });
                          const isExpanded = expandedItem === item.item_name;
                          const hasMatches = itemMatches.length > 0;

                          return (
                            <React.Fragment key={item.item_name}>
                              <tr
                                onClick={() => setExpandedItem(isExpanded ? null : item.item_name)}
                                style={{
                                  cursor: 'pointer', background: isExpanded ? T.tableAltRow : idx % 2 === 0 ? '#FFF' : T.tableAltRow,
                                  transition: 'background 0.15s ease',
                                }}
                                onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'rgba(0,107,107,0.04)'; }}
                                onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = idx % 2 === 0 ? '#FFF' : T.tableAltRow; }}
                              >
                                <td style={{ padding: '10px 16px', borderBottom: `1px solid ${T.divider}`, position: 'sticky', left: 0, background: 'inherit', zIndex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    {isExpanded ? <ChevronDown size={14} color={T.primary} /> : <ChevronRight size={14} color={T.label} />}
                                    {item.image_url ? (
                                      <img src={item.image_url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }}
                                        onError={(e) => { e.target.style.display = 'none'; }} />
                                    ) : (
                                      <div style={{ width: 36, height: 36, borderRadius: 6, background: T.divider, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Package size={14} color={T.noChange} />
                                      </div>
                                    )}
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontWeight: 600, color: T.body, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{item.item_name}</div>
                                    </div>
                                  </div>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: `1px solid ${T.divider}`, textAlign: 'center' }}>
                                  <span style={{ fontWeight: 700, color: T.primary, fontSize: 14 }}>AED {item.price?.toFixed(2)}</span>
                                </td>
                                {competitors.map(comp => {
                                  const match = matchByComp[comp];
                                  if (!match) {
                                    return (
                                      <td key={comp} style={{ padding: '10px 16px', borderBottom: `1px solid ${T.divider}`, textAlign: 'center' }}>
                                        <span style={{ color: T.noChange, fontSize: 12 }}>—</span>
                                      </td>
                                    );
                                  }
                                  const bgColor = match.price_diff > 0 ? 'rgba(102,187,106,0.08)' : match.price_diff < 0 ? 'rgba(229,115,115,0.08)' : 'transparent';
                                  return (
                                    <td key={comp} style={{ padding: '10px 16px', borderBottom: `1px solid ${T.divider}`, textAlign: 'center', background: bgColor }}>
                                      <div style={{ fontWeight: 600, color: T.body, fontSize: 13 }}>AED {match.price?.toFixed(2)}</div>
                                      <PriceCellBadge diff={match.price_diff} pct={match.price_diff_pct} />
                                    </td>
                                  );
                                })}
                              </tr>
                              {isExpanded && (
                                <ExpandedRowDetail
                                  item={item}
                                  matches={itemMatches}
                                  selectedBrand={selectedBrand}
                                  onLoadAnalysis={loadAnalysis}
                                  analysis={analyses[item.item_name]}
                                  analysisLoading={analysisLoadingItem === item.item_name}
                                />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    ))}
                    {groupedItems.length === 0 && (
                      <tr>
                        <td colSpan={2 + competitors.length} style={{ padding: 40, textAlign: 'center', color: T.label }}>
                          {searchQuery ? `No items matching "${searchQuery}"` : 'No items found'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ textAlign: 'center', padding: '16px 0', fontSize: 12, color: T.label }}>
              {matrixData.cached_note && <span>{matrixData.cached_note} • </span>}
              Scrape date: {matrixData.scrape_date}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
