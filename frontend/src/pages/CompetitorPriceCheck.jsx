import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Sparkles, Search, ArrowUpRight, ArrowDownRight, Minus, DollarSign, ChevronRight, Package } from 'lucide-react';
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
const selectStyle = { padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, background: '#FFF', cursor: 'pointer' };

const PriceDiffBadge = ({ diff, pct }) => {
  if (diff === 0 || diff === undefined) {
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 10px', borderRadius: 12, background: 'rgba(189,189,189,0.15)', color: T.noChange, fontWeight: 600 }}><Minus size={12} /> Same</span>;
  }
  const isHigher = diff > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '3px 10px', borderRadius: 12, fontWeight: 600,
      background: isHigher ? 'rgba(102,187,106,0.12)' : 'rgba(229,115,115,0.12)',
      color: isHigher ? T.priceDown : T.priceUp,
    }}>
      {isHigher ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      AED {Math.abs(diff).toFixed(2)} ({Math.abs(pct).toFixed(1)}%)
    </span>
  );
};

const ItemCard = ({ item, isOwn, onClick, isSelected }) => (
  <div
    onClick={onClick}
    style={{
      ...cardStyle,
      padding: 12, cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'flex-start',
      borderLeft: isOwn ? `4px solid ${T.primary}` : `4px solid transparent`,
      background: isSelected ? T.tableAltRow : T.cardBg,
      transition: 'all 0.15s ease',
    }}
  >
    {item.image_url ? (
      <img src={item.image_url} alt={item.item_name} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
        onError={(e) => { e.target.style.display = 'none'; }} />
    ) : (
      <div style={{ width: 56, height: 56, borderRadius: 8, background: T.divider, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Package size={20} color={T.noChange} />
      </div>
    )}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600, color: T.body, fontSize: 13, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.item_name}</div>
      {item.category && (
        <span style={{ display: 'inline-block', fontSize: 10, padding: '1px 6px', borderRadius: 8, background: T.accentBg, color: T.primary, fontWeight: 500, marginBottom: 2 }}>
          {item.category}
        </span>
      )}
      <div style={{ fontWeight: 700, color: T.primary, fontSize: 14 }}>AED {item.price?.toFixed(2)}</div>
    </div>
    <ChevronRight size={16} color={T.label} style={{ flexShrink: 0, marginTop: 20 }} />
  </div>
);

const CompetitorMatchCard = ({ match, ownPrice }) => {
  const priceDiffLabel = match.price > ownPrice ? 'Competitor higher' : match.price < ownPrice ? 'Competitor lower' : 'Same price';
  return (
    <div style={{ ...cardStyle, padding: 16, borderLeft: `4px solid ${match.price > ownPrice ? T.priceDown : match.price < ownPrice ? T.priceUp : T.noChange}` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {match.image_url ? (
          <img src={match.image_url} alt={match.item_name} style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
            onError={(e) => { e.target.style.display = 'none'; }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: 8, background: T.divider, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={24} color={T.noChange} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600, background: T.compBadgeBg, color: T.compBadgeText }}>{match.competitor_brand}</span>
            <span style={{ fontSize: 11, color: T.label }}>Match: {Math.round(match.match_confidence * 100)}%</span>
          </div>
          <div style={{ fontWeight: 600, color: T.body, fontSize: 14, marginBottom: 4 }}>{match.item_name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontWeight: 700, color: T.primary, fontSize: 16 }}>AED {match.price?.toFixed(2)}</span>
            {match.original_price && (
              <span style={{ textDecoration: 'line-through', color: T.label, fontSize: 13 }}>AED {match.original_price?.toFixed(2)}</span>
            )}
          </div>
          <PriceDiffBadge diff={match.price_diff} pct={match.price_diff_pct} />
          <div style={{ fontSize: 11, color: T.label, marginTop: 2 }}>{priceDiffLabel}</div>
          {match.description && (
            <div style={{ color: T.label, fontSize: 12, lineHeight: 1.4, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {match.description}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const CompetitorPriceCheckView = ({ onBack }) => {
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [items, setItems] = useState([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [matchData, setMatchData] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisCached, setAnalysisCached] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadBrands();
  }, []);

  const loadBrands = async () => {
    try {
      const res = await axios.get(`${API}/brands`);
      setBrands(res.data.brands || []);
      if (res.data.brands?.length > 0) {
        const first = res.data.brands[0].own_brand;
        setSelectedBrand(first);
        loadItems(first);
      }
    } catch (err) {
      toast.error('Error loading brands');
    }
  };

  const loadItems = async (brand) => {
    setItemsLoading(true);
    setSelectedItem(null);
    setMatchData(null);
    setAnalysis(null);
    try {
      const res = await axios.get(`${API}/items/${encodeURIComponent(brand)}`);
      setItems(res.data.items || []);
    } catch (err) {
      toast.error('Error loading items');
      setItems([]);
    }
    setItemsLoading(false);
  };

  const loadMatch = async (item) => {
    setSelectedItem(item);
    setMatchData(null);
    setMatchLoading(true);
    try {
      const res = await axios.get(`${API}/match/${encodeURIComponent(selectedBrand)}/${encodeURIComponent(item.item_name)}`);
      setMatchData(res.data);
      setAnalysis(null);
      if (res.data.matches?.length > 0) {
        loadAnalysis(res.data.own_item, res.data.matches, false);
      } else {
        setAnalysis(null);
      }
    } catch (err) {
      toast.error('Error matching items');
    }
    setMatchLoading(false);
  };

  const loadAnalysis = async (ownItem, matches, force = false) => {
    setAnalysisLoading(true);
    try {
      const res = await axios.post(`${API}/analyze`, {
        own_item: ownItem,
        matches: matches,
        own_brand: selectedBrand,
        force: force,
      });
      setAnalysis(res.data.analysis);
      setAnalysisCached(res.data.cached);
    } catch (err) {
      console.error('Error loading analysis:', err);
    }
    setAnalysisLoading(false);
  };

  const handleBrandChange = (brand) => {
    setSelectedBrand(brand);
    setSearchQuery('');
    loadItems(brand);
  };

  const filteredItems = items.filter(i =>
    i.item_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (i.category && i.category.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const ownPrice = matchData?.own_item?.price || 0;
  const avgCompPrice = matchData?.matches?.length > 0
    ? matchData.matches.reduce((s, m) => s + m.price, 0) / matchData.matches.length
    : 0;

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={20} /> Competitor Price Check
              </h1>
              <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>
                Compare your items against competitor pricing with AI analysis
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: T.label, fontWeight: 500 }}>Brand:</span>
                <select value={selectedBrand} onChange={(e) => handleBrandChange(e.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
                  {brands.map(b => (
                    <option key={b.own_brand} value={b.own_brand}>{b.own_brand}</option>
                  ))}
                </select>
              </div>
              <button onClick={onBack} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, minHeight: 'calc(100vh - 140px)' }}>
          <div style={{ ...cardStyle, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 140px)' }}>
            <div style={{ padding: 12, borderBottom: `1px solid ${T.divider}` }}>
              <div style={{ position: 'relative' }}>
                <Search size={16} color={T.label} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px 8px 32px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ fontSize: 11, color: T.label, marginTop: 6 }}>
                {filteredItems.length} items{searchQuery && ` matching "${searchQuery}"`}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {itemsLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: T.label, fontSize: 13 }}>Loading items...</div>
              ) : filteredItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: T.label, fontSize: 13 }}>
                  <Package size={32} color={T.noChange} />
                  <p style={{ marginTop: 8 }}>No items found</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {filteredItems.map((item) => (
                    <ItemCard
                      key={item.item_name}
                      item={item}
                      isOwn={true}
                      onClick={() => loadMatch(item)}
                      isSelected={selectedItem?.item_name === item.item_name}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {!selectedItem && !matchLoading && (
              <div style={{ ...cardStyle, padding: 60, textAlign: 'center' }}>
                <DollarSign size={48} color={T.noChange} />
                <p style={{ color: T.label, marginTop: 12, fontSize: 15 }}>Select an item from the list to see competitor price comparison</p>
              </div>
            )}

            {matchLoading && (
              <div style={{ ...cardStyle, padding: 60, textAlign: 'center' }}>
                <RefreshCw size={32} color={T.primary} className="animate-spin" />
                <p style={{ color: T.label, marginTop: 12, fontSize: 14 }}>Finding matching competitor items...</p>
              </div>
            )}

            {matchData && !matchLoading && (
              <>
                <div style={{ ...cardStyle, padding: 20, borderLeft: `4px solid ${T.primary}` }}>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    {matchData.own_item.image_url ? (
                      <img src={matchData.own_item.image_url} alt={matchData.own_item.item_name} style={{ width: 96, height: 96, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
                        onError={(e) => { e.target.style.display = 'none'; }} />
                    ) : (
                      <div style={{ width: 96, height: 96, borderRadius: 12, background: T.divider, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Package size={32} color={T.noChange} />
                      </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 12, fontWeight: 600, background: T.ownBadgeBg, color: T.ownBadgeText }}>YOUR ITEM</span>
                        <span style={{ fontSize: 12, color: T.label }}>{selectedBrand}</span>
                      </div>
                      <h2 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: T.title }}>{matchData.own_item.item_name}</h2>
                      {matchData.own_item.category && (
                        <span style={{ display: 'inline-block', fontSize: 11, padding: '2px 8px', borderRadius: 8, background: T.accentBg, color: T.primary, fontWeight: 500, marginBottom: 6 }}>
                          {matchData.own_item.category}
                        </span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, color: T.primary, fontSize: 22 }}>AED {matchData.own_item.price?.toFixed(2)}</span>
                        {matchData.own_item.original_price && (
                          <span style={{ textDecoration: 'line-through', color: T.label, fontSize: 14 }}>AED {matchData.own_item.original_price?.toFixed(2)}</span>
                        )}
                      </div>
                      {matchData.own_item.description && (
                        <div style={{ color: T.label, fontSize: 13, lineHeight: 1.5, marginTop: 4 }}>{matchData.own_item.description}</div>
                      )}
                    </div>
                    {matchData.matches.length > 0 && (
                      <div style={{ textAlign: 'center', padding: '12px 20px', background: T.tableAltRow, borderRadius: 12, flexShrink: 0 }}>
                        <div style={{ fontSize: 11, color: T.label, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Avg Competitor</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: avgCompPrice > ownPrice ? T.priceDown : avgCompPrice < ownPrice ? T.priceUp : T.body }}>
                          AED {avgCompPrice.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 11, color: T.label, marginTop: 2 }}>
                          {matchData.matches.length} match{matchData.matches.length !== 1 ? 'es' : ''}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {matchData.matches.length > 0 ? (
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: T.title, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                      Competitor Matches
                      {matchData.cached && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: T.accentBg, color: T.primary, fontWeight: 500 }}>Cached</span>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
                      {matchData.matches.map((match, idx) => (
                        <CompetitorMatchCard key={idx} match={match} ownPrice={matchData.own_item.price} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
                    <Package size={32} color={T.noChange} />
                    <p style={{ color: T.label, marginTop: 8, fontSize: 14 }}>No matching competitor items found for this product</p>
                  </div>
                )}

                {matchData.matches.length > 0 && (
                  <div style={{ ...cardStyle, padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <h3 style={{ margin: 0, color: T.title, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Sparkles size={16} color={T.accent} /> AI Pricing Analysis
                      </h3>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {analysisCached && <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: T.accentBg, color: T.primary, fontWeight: 500 }}>Cached</span>}
                        <button
                          onClick={() => loadAnalysis(matchData.own_item, matchData.matches, true)}
                          disabled={analysisLoading}
                          style={{ ...headerBtnStyle, fontSize: 12, padding: '6px 12px' }}
                        >
                          <RefreshCw size={12} className={analysisLoading ? 'animate-spin' : ''} />
                          {analysisLoading ? 'Analyzing...' : 'Refresh Analysis'}
                        </button>
                      </div>
                    </div>
                    {analysisLoading && !analysis ? (
                      <div style={{ color: T.label, fontSize: 14, padding: '12px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <RefreshCw size={14} className="animate-spin" /> Generating pricing analysis...
                      </div>
                    ) : analysis ? (
                      <div style={{
                        padding: '16px 20px',
                        background: 'linear-gradient(135deg, rgba(126,217,87,0.06) 0%, rgba(0,107,107,0.06) 100%)',
                        borderRadius: 10,
                        borderLeft: `3px solid ${T.accent}`,
                        color: T.body,
                        fontSize: 14,
                        lineHeight: 1.7,
                        whiteSpace: 'pre-wrap',
                      }}>
                        {analysis}
                      </div>
                    ) : (
                      <div style={{ color: T.label, fontSize: 14 }}>No analysis available. Click Refresh Analysis to generate.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
