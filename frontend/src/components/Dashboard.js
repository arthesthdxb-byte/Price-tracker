import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Upload, RefreshCw, Download, X, Settings, ChevronDown, ChevronRight, Plus, Trash2, Edit2, Save, Package, Eye, EyeOff, Sparkles, TrendingUp } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import axios from 'axios';

const API = '/api';

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

const generateDateOptions = () => {
  const dates = [];
  const months = [
    { name: 'Feb', days: 28 }, { name: 'Mar', days: 31 }, { name: 'Apr', days: 30 },
    { name: 'May', days: 31 }, { name: 'Jun', days: 30 }, { name: 'Jul', days: 31 },
    { name: 'Aug', days: 31 }, { name: 'Sep', days: 30 }, { name: 'Oct', days: 31 },
    { name: 'Nov', days: 30 }, { name: 'Dec', days: 31 }
  ];
  months.forEach(month => {
    for (let day = 1; day <= month.days; day++) dates.push(`${day}-${month.name}-26`);
  });
  return dates;
};

const StatCell = ({ value, color, bg }) => (
  <td className="text-center p-4">
    {value > 0 ? (
      <span className="inline-block px-3 py-1 rounded-full text-sm font-semibold" style={{ backgroundColor: bg, color }}>{value}</span>
    ) : (
      <span style={{ color: T.noChange }}>&mdash;</span>
    )}
  </td>
);

const KpiCard = ({ label, value, color }) => (
  <div style={{ background: T.cardBg, borderRadius: T.cardRadius, boxShadow: T.cardShadow, borderLeft: `4px solid ${color}`, padding: '16px 20px' }}>
    <div style={{ color, fontSize: '28px', fontWeight: 700 }}>{value}</div>
    <div style={{ color: T.label, fontSize: '13px', marginTop: 4 }}>{label}</div>
  </div>
);

const NpdItemCard = ({ item, type }) => {
  const borderColor = type === 'new' ? T.newItem : T.removed;
  return (
    <div style={{
      background: T.cardBg, borderRadius: '10px', boxShadow: T.cardShadow,
      borderLeft: `4px solid ${borderColor}`, padding: '12px', display: 'flex', gap: '12px', alignItems: 'flex-start'
    }}>
      {item.image_url ? (
        <img src={item.image_url} alt={item.item_name} style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }}
          onError={(e) => { e.target.style.display = 'none'; }} />
      ) : (
        <div style={{ width: 72, height: 72, borderRadius: 8, background: T.divider, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Package size={24} color={T.noChange} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: T.body, fontSize: '14px', marginBottom: 4 }}>{item.item_name}</div>
        {item.category && (
          <span style={{ display: 'inline-block', fontSize: '11px', padding: '2px 8px', borderRadius: 12, background: T.accentBg, color: T.primary, fontWeight: 500, marginBottom: 4 }}>
            {item.category}
          </span>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontWeight: 700, color: T.primary, fontSize: '15px' }}>AED {item.price?.toFixed(2)}</span>
          {item.original_price && (
            <span style={{ textDecoration: 'line-through', color: T.label, fontSize: '13px' }}>AED {item.original_price?.toFixed(2)}</span>
          )}
        </div>
        {item.description && (
          <div style={{ color: T.label, fontSize: '12px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {item.description}
          </div>
        )}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [hasBaseline, setHasBaseline] = useState(false);
  const [baselineDate, setBaselineDate] = useState('24-Feb-25');
  const [dashboardData, setDashboardData] = useState(null);
  const [scrapeDate, setScrapeDate] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [brandHistory, setBrandHistory] = useState(null);
  const [itemsHistory, setItemsHistory] = useState(null);
  const [allHistory, setAllHistory] = useState(null);
  const [itemFilter, setItemFilter] = useState('all');
  const [viewMode, setViewMode] = useState('dashboard');
  const [dateOptions] = useState(generateDateOptions());
  const [setAsBaseline, setSetAsBaseline] = useState(false);
  const [stagedMasterFile, setStagedMasterFile] = useState(null);
  const [stagedScrapeFiles, setStagedScrapeFiles] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [brandGroups, setBrandGroups] = useState([]);
  const [compareMode, setCompareMode] = useState('baseline');
  const [compareDate, setCompareDate] = useState('');
  const [compareData, setCompareData] = useState(null);
  const [historyCompareMode, setHistoryCompareMode] = useState('baseline');
  const [showManageBrands, setShowManageBrands] = useState(false);
  const [newBrandOwn, setNewBrandOwn] = useState('');
  const [newBrandCompetitors, setNewBrandCompetitors] = useState('');
  const [editingBrand, setEditingBrand] = useState(null);
  const [editCompetitors, setEditCompetitors] = useState('');
  const [expandedSummaries, setExpandedSummaries] = useState({});
  const [npdData, setNpdData] = useState(null);
  const [npdSummary, setNpdSummary] = useState(null);
  const [npdLoading, setNpdLoading] = useState(false);
  const [npdSummaryLoading, setNpdSummaryLoading] = useState(false);
  const [expandedRemovedBrands, setExpandedRemovedBrands] = useState({});
  const [npdAvailableDates, setNpdAvailableDates] = useState([]);
  const [npdBaselineDate, setNpdBaselineDate] = useState('');
  const [npdLatestDate, setNpdLatestDate] = useState('');

  const allBrands = useMemo(() => brandGroups.flatMap(g => [g.own, ...g.competitors]), [brandGroups]);

  useEffect(() => { checkBaseline(); loadDashboard(); loadBrandGroups(); }, []);

  const checkBaseline = async () => {
    try {
      const response = await axios.get(`${API}/baseline`);
      setHasBaseline(response.data.exists);
      if (response.data.baseline_date) setBaselineDate(response.data.baseline_date);
    } catch (error) { console.error('Error checking baseline:', error); }
  };

  const loadDashboard = async () => {
    try {
      const response = await axios.get(`${API}/dashboard`);
      if (response.data.has_data) setDashboardData(response.data);
    } catch (error) { console.error('Error loading dashboard:', error); }
  };

  const loadBrandGroups = async () => {
    try {
      const response = await axios.get(`${API}/brand-groups`);
      const groups = (response.data.brand_groups || []).map(g => ({
        own: g.own_brand, competitors: g.competitors || [], group_order: g.group_order
      }));
      setBrandGroups(groups);
    } catch (error) { console.error('Error loading brand groups:', error); }
  };

  useEffect(() => {
    if (compareMode === 'date' && compareDate) loadCompareData(compareDate);
    else setCompareData(null);
  }, [compareMode, compareDate]);

  const loadCompareData = async (targetDate) => {
    try {
      const response = await axios.get(`${API}/compare/${encodeURIComponent(targetDate)}`);
      setCompareData(response.data);
    } catch (error) { toast.error('Error loading comparison'); }
  };

  const parseExcelFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const brands = {};
          const skipKeywords = ['Executive Summary', 'Price History', 'Trend Data', 'Price Increases', 'Price Decreases'];
          workbook.SheetNames.forEach((sheetName) => {
            if (skipKeywords.some(kw => sheetName.includes(kw))) return;
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            const items = {};
            for (let i = 5; i < Math.min(605, jsonData.length); i++) {
              const row = jsonData[i];
              if (!row) continue;
              const itemName = row[6]; const price = row[7];
              if (itemName && price !== undefined && price !== null && price !== '') {
                const tn = String(itemName).trim(); const pp = parseFloat(price);
                if (tn && !isNaN(pp)) items[tn] = pp;
              }
            }
            if (Object.keys(items).length > 0) brands[sheetName] = items;
          });
          resolve(brands);
        } catch (error) { reject(error); }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const parseScrapeFiles = (files) => {
    return new Promise((resolve) => {
      const brands = {};
      const processFile = (file) => new Promise((rf) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            workbook.SheetNames.forEach((sheetName) => {
              const sheet = workbook.Sheets[sheetName];
              const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
              const items = {};
              for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i]; if (!row) continue;
                const category = row[0] ? String(row[0]).trim() : '';
                const itemName = row[1];
                const price = row[2];
                const originalPrice = row[3];
                const description = row[4] ? String(row[4]).trim() : '';
                const imageUrl = row[5] ? String(row[5]).trim() : '';
                if (itemName && price !== undefined && price !== null && price !== '') {
                  const tn = String(itemName).trim();
                  const pp = parseFloat(price);
                  if (tn && !isNaN(pp)) {
                    const op = originalPrice !== undefined && originalPrice !== null && originalPrice !== '' ? parseFloat(originalPrice) : null;
                    items[tn] = {
                      price: pp,
                      original_price: (op && !isNaN(op)) ? op : null,
                      description: description,
                      category: category,
                      image_url: imageUrl,
                    };
                  }
                }
              }
              if (Object.keys(items).length > 0) brands[sheetName] = items;
            });
            rf();
          } catch (e) { console.error('Error parsing scrape:', e); rf(); }
        };
        reader.readAsArrayBuffer(file);
      });
      const promises = [];
      for (let i = 0; i < files.length; i++) promises.push(processFile(files[i]));
      Promise.all(promises).then(() => resolve(brands));
    });
  };

  const handleMasterUpload = async () => {
    if (!stagedMasterFile) { toast.error('Please select a master file'); return; }
    setUploading(true);
    try {
      const brands = await parseExcelFile(stagedMasterFile);
      const response = await axios.post(`${API}/baseline`, { brands, baseline_date: baselineDate });
      if (response.data.success) {
        toast.success(`Master uploaded — ${response.data.brands_count} brands, ${response.data.items_count} items`);
        setHasBaseline(true); setShowUploadModal(false); setStagedMasterFile(null);
      }
    } catch (error) { toast.error('Error uploading master file'); }
    setUploading(false);
  };

  const handleScrapeUpload = async () => {
    if (!stagedScrapeFiles || stagedScrapeFiles.length === 0) { toast.error('Please select scrape files'); return; }
    if (!scrapeDate) { toast.error('Please select the scrape date'); return; }
    setUploading(true);
    try {
      const brands = await parseScrapeFiles(stagedScrapeFiles);
      const response = await axios.post(`${API}/scrape`, { scrape_date: scrapeDate, brands, set_as_baseline: setAsBaseline });
      if (response.data.success) {
        let msg = `Scrape uploaded — ${response.data.brands_count} brands analyzed`;
        if (setAsBaseline) msg += ' (Baseline updated)';
        if (response.data.new_baselines_created > 0) msg += ` (${response.data.new_baselines_created} new baselines)`;
        if (response.data.ai_summary) msg += ' + AI summary';
        toast.success(msg);
        await loadDashboard(); await checkBaseline(); await loadBrandGroups();
        setScrapeDate(''); setSetAsBaseline(false); setStagedScrapeFiles(null);
      }
    } catch (error) { toast.error(error.response?.data?.detail || 'Error uploading scrape'); }
    setUploading(false);
  };

  const viewBrandHistory = async (brandName) => {
    try {
      const response = await axios.get(`${API}/brand-history/${encodeURIComponent(brandName)}`);
      setBrandHistory(response.data); setSelectedBrand(brandName); setHistoryCompareMode('baseline'); setViewMode('brand-history');
    } catch (error) { toast.error('Error loading brand history'); }
  };

  const viewItemsHistory = async (brandName) => {
    try {
      const response = await axios.get(`${API}/items/${encodeURIComponent(brandName)}`);
      setItemsHistory(response.data); setSelectedBrand(brandName); setItemFilter('all'); setViewMode('items-history');
    } catch (error) { toast.error('Error loading items history'); }
  };

  const viewAllHistory = async () => {
    try {
      const response = await axios.get(`${API}/all-history`);
      setAllHistory(response.data); setViewMode('all-history');
    } catch (error) { toast.error('Error loading all history'); }
  };

  const npdQueryParams = (bl, lt) => {
    const params = [];
    if (bl) params.push(`baseline_date=${encodeURIComponent(bl)}`);
    if (lt) params.push(`latest_date=${encodeURIComponent(lt)}`);
    return params.length > 0 ? `?${params.join('&')}` : '';
  };

  const viewNpdTracker = async () => {
    setViewMode('npd');
    setNpdLoading(true);
    setNpdSummary(null);
    try {
      const response = await axios.get(`${API}/npd`);
      setNpdData(response.data);
      setNpdAvailableDates(response.data.available_dates || []);
      if (response.data.has_data) {
        setNpdBaselineDate(response.data.previous_date || '');
        setNpdLatestDate(response.data.latest_date || '');
        setNpdSummaryLoading(true);
        try {
          const summaryRes = await axios.get(`${API}/npd-ai-summary`);
          setNpdSummary(summaryRes.data.summary);
        } catch (err) { console.error('Error loading NPD summary:', err); }
        setNpdSummaryLoading(false);
      }
    } catch (error) { toast.error('Error loading NPD data'); }
    setNpdLoading(false);
  };

  const loadNpdForDates = async (bl, lt) => {
    setNpdBaselineDate(bl);
    setNpdLatestDate(lt);
    setNpdLoading(true);
    setNpdSummary(null);
    try {
      const response = await axios.get(`${API}/npd${npdQueryParams(bl, lt)}`);
      setNpdData(response.data);
      if (response.data.has_data) {
        setNpdSummaryLoading(true);
        try {
          const summaryRes = await axios.get(`${API}/npd-ai-summary${npdQueryParams(bl, lt)}`);
          setNpdSummary(summaryRes.data.summary);
        } catch (err) { console.error('Error loading NPD summary:', err); }
        setNpdSummaryLoading(false);
      }
    } catch (error) { toast.error('Error loading NPD data'); }
    setNpdLoading(false);
  };

  const regenerateNpdSummary = async () => {
    setNpdSummaryLoading(true);
    try {
      const res = await axios.post(`${API}/npd-ai-summary/regenerate${npdQueryParams(npdBaselineDate, npdLatestDate)}`);
      setNpdSummary(res.data.summary);
      toast.success('NPD summary regenerated');
    } catch (error) { toast.error('Error regenerating summary'); }
    setNpdSummaryLoading(false);
  };

  const handleAddBrandGroup = async () => {
    if (!newBrandOwn.trim()) { toast.error('Enter an own brand name'); return; }
    try {
      const competitors = newBrandCompetitors.split(',').map(s => s.trim()).filter(Boolean);
      await axios.post(`${API}/brand-groups`, { own_brand: newBrandOwn.trim(), competitors, group_order: brandGroups.length + 1 });
      toast.success(`Added ${newBrandOwn.trim()}`); setNewBrandOwn(''); setNewBrandCompetitors('');
      await loadBrandGroups(); await loadDashboard();
    } catch (error) { toast.error('Error adding brand group'); }
  };

  const handleUpdateBrandGroup = async (ownBrand) => {
    try {
      const competitors = editCompetitors.split(',').map(s => s.trim()).filter(Boolean);
      await axios.put(`${API}/brand-groups/${encodeURIComponent(ownBrand)}`, { competitors });
      toast.success(`Updated ${ownBrand}`); setEditingBrand(null); await loadBrandGroups();
    } catch (error) { toast.error('Error updating brand group'); }
  };

  const handleDeleteBrandGroup = async (ownBrand) => {
    if (!window.confirm(`Delete ${ownBrand} and its competitor group?`)) return;
    try {
      await axios.delete(`${API}/brand-groups/${encodeURIComponent(ownBrand)}`);
      toast.success(`Deleted ${ownBrand}`); await loadBrandGroups(); await loadDashboard();
    } catch (error) { toast.error('Error deleting brand group'); }
  };

  const toggleSummary = (key) => setExpandedSummaries(prev => ({ ...prev, [key]: !prev[key] }));
  const toggleRemovedBrand = (brand) => setExpandedRemovedBrands(prev => ({ ...prev, [brand]: !prev[brand] }));

  const regenerateSummary = async (date) => {
    try {
      toast.info('Regenerating AI summary...');
      const response = await axios.post(`${API}/regenerate-summary/${encodeURIComponent(date)}`);
      if (response.data.success) { toast.success('AI summary regenerated'); await loadDashboard(); }
    } catch (error) { toast.error('Error regenerating summary'); }
  };

  const exportResults = () => {
    if (!dashboardData) return;
    const exportData = [['Brand', 'Type', 'Price Up', 'Price Down', 'New Items', 'Removed', 'No Change', 'Total', 'Change %']];
    brandGroups.forEach((group) => {
      const ownBrand = dashboardData.brands.find(b => b.brand_name === group.own);
      if (ownBrand) {
        const d = ownBrand.latest_data.vs_baseline || {};
        exportData.push([group.own, 'OWN', d.price_up||0, d.price_down||0, d.new_items||0, d.removed||0, d.no_change||0, d.total||0, d.change_percent ? d.change_percent.toFixed(1)+'%' : '0%']);
      }
      group.competitors.forEach((comp) => {
        const cb = dashboardData.brands.find(b => b.brand_name === comp);
        if (cb) {
          const d = cb.latest_data.vs_baseline || {};
          exportData.push([comp, 'COMP', d.price_up||0, d.price_down||0, d.new_items||0, d.removed||0, d.no_change||0, d.total||0, d.change_percent ? d.change_percent.toFixed(1)+'%' : '0%']);
        }
      });
    });
    const ws = XLSX.utils.aoa_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparison Results');
    XLSX.writeFile(wb, `Menu_Price_Tracker_${dashboardData.latest_date.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
    toast.success('Results exported');
  };

  const getItemPrice = (itemData) => {
    if (typeof itemData === 'object' && itemData !== null && 'price' in itemData) return itemData.price;
    return itemData;
  };

  const getBrandStats = (brandName) => {
    if (!dashboardData) return {};
    const brand = dashboardData.brands.find(b => b.brand_name === brandName);
    if (!brand) return {};
    if (compareMode === 'date' && compareData) {
      const match = compareData.brands.find(b => b.brand_name === brandName);
      return match?.stats || {};
    }
    if (compareMode === 'previous') return brand.latest_data?.vs_previous || {};
    return brand.latest_data?.vs_baseline || {};
  };

  const calculateOwnBrandsTotals = () => {
    if (!dashboardData) return { price_up: 0, price_down: 0, new_items: 0, removed: 0, no_change: 0, total: 0 };
    const totals = { price_up: 0, price_down: 0, new_items: 0, removed: 0, no_change: 0, total: 0 };
    brandGroups.forEach(g => {
      const d = getBrandStats(g.own);
      totals.price_up += d.price_up || 0; totals.price_down += d.price_down || 0;
      totals.new_items += d.new_items || 0; totals.removed += d.removed || 0;
      totals.no_change += d.no_change || 0; totals.total += d.total || 0;
    });
    return totals;
  };

  const compareModeLabel = () => {
    if (compareMode === 'baseline') return `vs Baseline (${baselineDate})`;
    if (compareMode === 'previous') return `vs Previous Date (${dashboardData?.previous_date || '-'})`;
    if (compareMode === 'date') return `vs ${compareDate || 'Select Date'}`;
    return '';
  };

  const cardStyle = { background: T.cardBg, borderRadius: T.cardRadius, boxShadow: T.cardShadow, border: `1px solid ${T.border}` };
  const headerBtnStyle = { background: T.cardBg, border: `1px solid ${T.border}`, color: T.primary, borderRadius: '8px', padding: '8px 16px', cursor: 'pointer', fontWeight: 500, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: 6 };
  const headerBtnAccent = { ...headerBtnStyle, background: T.primary, color: '#FFF', border: `1px solid ${T.primary}` };
  const thStyle = { background: T.tableHeader, color: '#FFFFFF', padding: '12px 16px', fontWeight: 600, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' };
  const tdStyle = { padding: '12px 16px', borderBottom: `1px solid ${T.border}` };

  if (viewMode === 'npd') {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0 }}>
                  <Package size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
                  NPD Tracker
                </h1>
                <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>
                  {npdData?.has_data ? `Comparing ${npdData.previous_date} → ${npdData.latest_date}` : 'Loading...'}
                </p>
                {npdAvailableDates.length > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: T.label, fontWeight: 500 }}>Baseline:</span>
                      <select value={npdBaselineDate} onChange={(e) => loadNpdForDates(e.target.value, npdLatestDate)}
                        style={{ padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, background: '#FFF', cursor: 'pointer' }}>
                        {npdAvailableDates.filter(d => d !== npdLatestDate).reverse().map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: T.label, fontWeight: 500 }}>Latest:</span>
                      <select value={npdLatestDate} onChange={(e) => loadNpdForDates(npdBaselineDate, e.target.value)}
                        style={{ padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body, background: '#FFF', cursor: 'pointer' }}>
                        {npdAvailableDates.filter(d => d !== npdBaselineDate).reverse().map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={() => setViewMode('dashboard')} style={headerBtnStyle}><X size={14} /> Back</button>
              </div>
            </div>
          </div>

          {npdLoading ? (
            <div style={{ textAlign: 'center', padding: 60, color: T.label }}>Loading NPD data...</div>
          ) : !npdData?.has_data ? (
            <div style={{ ...cardStyle, padding: 40, textAlign: 'center' }}>
              <Package size={48} color={T.noChange} />
              <p style={{ color: T.label, marginTop: 12 }}>{npdData?.message || 'No NPD data available. Upload at least 2 scrape dates.'}</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
                <KpiCard label="New Items Launched" value={npdData.total_new} color={T.newItem} />
                <KpiCard label="Items Removed" value={npdData.total_removed} color={T.removed} />
                <KpiCard label="Brands with Changes" value={npdData.brands_with_changes} color={T.primary} />
              </div>

              <div style={{ ...cardStyle, padding: 20, marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h3 style={{ margin: 0, color: T.title, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Sparkles size={16} color={T.accent} /> AI Summary
                  </h3>
                  <button onClick={regenerateNpdSummary} disabled={npdSummaryLoading} style={{ ...headerBtnStyle, fontSize: 12, padding: '6px 12px' }}>
                    <RefreshCw size={12} className={npdSummaryLoading ? 'animate-spin' : ''} /> {npdSummaryLoading ? 'Generating...' : 'Regenerate'}
                  </button>
                </div>
                {npdSummaryLoading && !npdSummary ? (
                  <div style={{ color: T.label, fontSize: 14, padding: '12px 0' }}>Generating AI summary...</div>
                ) : npdSummary ? (
                  <div style={{ color: T.body, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{npdSummary}</div>
                ) : (
                  <div style={{ color: T.label, fontSize: 14 }}>No summary available. Click Regenerate.</div>
                )}
              </div>

              {npdData.brands.map((brand, idx) => (
                <div key={idx} style={{ ...cardStyle, padding: 20, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <h3 style={{ margin: 0, color: T.title, fontSize: 16, fontWeight: 600 }}>{brand.brand_name}</h3>
                    <span style={{
                      fontSize: 11, padding: '2px 10px', borderRadius: 12, fontWeight: 600,
                      background: brand.is_own_brand ? T.ownBadgeBg : T.compBadgeBg,
                      color: brand.is_own_brand ? T.ownBadgeText : T.compBadgeText,
                    }}>
                      {brand.is_own_brand ? 'OWN' : 'COMP'}
                    </span>
                    {brand.new_count > 0 && (
                      <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: 'rgba(66,165,245,0.15)', color: T.newItem, fontWeight: 600 }}>
                        {brand.new_count} new
                      </span>
                    )}
                    {brand.removed_count > 0 && (
                      <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: 'rgba(255,167,38,0.15)', color: T.removed, fontWeight: 600 }}>
                        {brand.removed_count} removed
                      </span>
                    )}
                  </div>

                  {brand.new_items.length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.newItem, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendingUp size={14} /> New Items Launched
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                        {brand.new_items.map((item, iIdx) => (
                          <NpdItemCard key={iIdx} item={item} type="new" />
                        ))}
                      </div>
                    </div>
                  )}

                  {brand.removed_items.length > 0 && (
                    <div>
                      <button onClick={() => toggleRemovedBrand(brand.brand_name)} style={{
                        background: 'none', border: `1px solid ${T.border}`, borderRadius: 8, padding: '8px 14px',
                        cursor: 'pointer', fontSize: 13, fontWeight: 600, color: T.removed, display: 'flex', alignItems: 'center', gap: 6
                      }}>
                        {expandedRemovedBrands[brand.brand_name] ? <EyeOff size={14} /> : <Eye size={14} />}
                        {expandedRemovedBrands[brand.brand_name] ? 'Hide' : 'Show'} Removed Items ({brand.removed_count})
                      </button>
                      {expandedRemovedBrands[brand.brand_name] && (
                        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
                          {brand.removed_items.map((item, iIdx) => (
                            <NpdItemCard key={iIdx} item={item} type="removed" />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  if (viewMode === 'all-history' && allHistory) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0 }}>All History Timeline</h1>
                <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>Day-by-day summary across all own brands | Baseline: {baselineDate}</p>
              </div>
              <button onClick={() => setViewMode('dashboard')} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            <KpiCard label="Total Dates" value={allHistory.dates_summary.length} color={T.primary} />
            <KpiCard label="Latest Upload" value={allHistory.latest_date} color={T.priceDown} />
            <KpiCard label="Brands Tracked" value={allHistory.total_brands} color={T.newItem} />
            <KpiCard label="Own Brands" value={allHistory.own_brands_count} color={T.accent} />
          </div>
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>DATE</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>BRANDS</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>UP</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>DOWN</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>NEW</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>REMOVED</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>NO CHG</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>TOTAL</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>CHG%</th>
                  </tr>
                </thead>
                <tbody>
                  {allHistory.dates_summary.map((dd, idx) => {
                    const cp = dd.total_items > 0 ? ((dd.total_price_up + dd.total_price_down) / dd.total_items) * 100 : 0;
                    return (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                        <td style={tdStyle}><span style={{ fontWeight: 600, color: T.body }}>{dd.date}</span>{dd.date === allHistory.latest_date && <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 12, background: T.accentBg, color: T.primary, fontWeight: 600 }}>Latest</span>}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: T.body }}>{dd.brands_count}</td>
                        <StatCell value={dd.total_price_up} color={T.priceUp} bg="rgba(229,115,115,0.15)" />
                        <StatCell value={dd.total_price_down} color={T.priceDown} bg="rgba(102,187,106,0.15)" />
                        <StatCell value={dd.total_new_items} color={T.newItem} bg="rgba(66,165,245,0.15)" />
                        <StatCell value={dd.total_removed} color={T.removed} bg="rgba(255,167,38,0.15)" />
                        <StatCell value={dd.total_no_change} color={T.noChange} bg="rgba(189,189,189,0.15)" />
                        <td style={{ ...tdStyle, textAlign: 'center' }}><span style={{ color: T.primary, fontWeight: 600 }}>{dd.total_items}</span></td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                            background: cp > 50 ? 'rgba(229,115,115,0.15)' : cp > 20 ? 'rgba(255,167,38,0.15)' : 'rgba(102,187,106,0.15)',
                            color: cp > 50 ? T.priceUp : cp > 20 ? T.removed : T.priceDown
                          }}>{cp.toFixed(1)}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'brand-history' && brandHistory) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0 }}>{selectedBrand}</h1>
                <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>Day-wise Price Change History</p>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <button onClick={() => setHistoryCompareMode('baseline')} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', background: historyCompareMode === 'baseline' ? T.accentBg : '#FFF', color: historyCompareMode === 'baseline' ? T.primary : T.label }}>vs Baseline</button>
                  <button onClick={() => setHistoryCompareMode('previous')} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderLeft: `1px solid ${T.border}`, background: historyCompareMode === 'previous' ? 'rgba(126,217,87,0.25)' : '#FFF', color: historyCompareMode === 'previous' ? T.primary : T.label }}>vs Previous</button>
                </div>
                <button onClick={() => viewItemsHistory(selectedBrand)} style={{ ...headerBtnStyle, color: T.newItem }}>View Items</button>
                <button onClick={() => setViewMode('dashboard')} style={headerBtnStyle}><X size={14} /> Back</button>
              </div>
            </div>
          </div>
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>DATE</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>UP</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>DOWN</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>NEW</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>REM</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>NC</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>TOTAL</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>CHG%</th>
                </tr>
              </thead>
              <tbody>
                {brandHistory.history.map((item, idx) => {
                  const stats = historyCompareMode === 'previous' && item.vs_previous ? item.vs_previous : (item.vs_baseline || item);
                  return (
                    <tr key={idx} style={{ background: idx % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                      <td style={tdStyle}><span style={{ fontWeight: 600, color: T.body }}>{item.date}</span>{historyCompareMode === 'previous' && !item.vs_previous && <span style={{ display: 'block', color: T.label, fontSize: 11 }}>No previous data</span>}</td>
                      <StatCell value={stats.price_up} color={T.priceUp} bg="rgba(229,115,115,0.15)" />
                      <StatCell value={stats.price_down} color={T.priceDown} bg="rgba(102,187,106,0.15)" />
                      <StatCell value={stats.new_items} color={T.newItem} bg="rgba(66,165,245,0.15)" />
                      <StatCell value={stats.removed} color={T.removed} bg="rgba(255,167,38,0.15)" />
                      <StatCell value={stats.no_change} color={T.noChange} bg="rgba(189,189,189,0.15)" />
                      <td style={{ ...tdStyle, textAlign: 'center' }}><span style={{ color: T.primary, fontWeight: 600 }}>{stats.total || 0}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                          background: (stats.change_percent||0) > 50 ? 'rgba(229,115,115,0.15)' : (stats.change_percent||0) > 20 ? 'rgba(255,167,38,0.15)' : 'rgba(102,187,106,0.15)',
                          color: (stats.change_percent||0) > 50 ? T.priceUp : (stats.change_percent||0) > 20 ? T.removed : T.priceDown
                        }}>{(stats.change_percent||0).toFixed(1)}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {brandHistory.history.some(h => h.ai_summary) && (
            <div style={{ marginTop: 24 }}>
              <h3 style={{ color: T.title, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}><Sparkles size={16} color={T.accent} /> AI Summaries</h3>
              {brandHistory.history.filter(h => h.ai_summary).map((item, idx) => (
                <div key={idx} style={{ ...cardStyle, marginBottom: 8 }}>
                  <button onClick={() => toggleSummary(`bh-${item.date}`)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: 'none', border: 'none', cursor: 'pointer' }}>
                    <span style={{ color: T.body, fontWeight: 600, fontSize: 14 }}>{item.date}</span>
                    {expandedSummaries[`bh-${item.date}`] ? <ChevronDown size={16} color={T.label} /> : <ChevronRight size={16} color={T.label} />}
                  </button>
                  {expandedSummaries[`bh-${item.date}`] && <div style={{ padding: '0 16px 16px', color: T.label, fontSize: 14, whiteSpace: 'pre-wrap' }}>{item.ai_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (viewMode === 'items-history' && itemsHistory) {
    const getFilteredItems = () => {
      if (itemFilter === 'all') return itemsHistory.items;
      return itemsHistory.items.filter(item => {
        const baseline = item.baseline_price;
        const latestPrice = item.history[item.history.length - 1]?.price;
        if (itemFilter === 'added') return baseline === null || baseline === undefined;
        if (itemFilter === 'increased') return baseline !== null && latestPrice !== null && latestPrice > baseline;
        if (itemFilter === 'decreased') return baseline !== null && latestPrice !== null && latestPrice < baseline;
        return true;
      });
    };
    const filteredItems = getFilteredItems();
    const totalItems = itemsHistory.items.length;
    const dateColumns = itemsHistory.items[0]?.history.slice(1) || [];
    const filterBtnStyle = (active, color) => ({
      padding: '6px 14px', borderRadius: 8, border: active ? 'none' : `1px solid ${T.border}`, cursor: 'pointer',
      background: active ? color : '#FFF', color: active ? '#FFF' : color, fontWeight: 600, fontSize: 13,
    });

    return (
      <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h1 style={{ fontSize: 24, fontWeight: 700, color: T.title, margin: 0 }}>{selectedBrand}</h1>
                <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>Item-wise Price History | Baseline: {itemsHistory.baseline_date}</p>
              </div>
              <button onClick={() => setViewMode('dashboard')} style={headerBtnStyle}><X size={14} /> Back</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={() => setItemFilter('all')} style={filterBtnStyle(itemFilter === 'all', T.primary)}>All Items ({totalItems})</button>
              <button onClick={() => setItemFilter('added')} style={filterBtnStyle(itemFilter === 'added', T.newItem)}>Added Items</button>
              <button onClick={() => setItemFilter('increased')} style={filterBtnStyle(itemFilter === 'increased', T.priceUp)}>Price Increased</button>
              <button onClick={() => setItemFilter('decreased')} style={filterBtnStyle(itemFilter === 'decreased', T.priceDown)}>Price Decreased</button>
            </div>
          </div>
          <div style={{ ...cardStyle, overflow: 'hidden' }}>
            {filteredItems.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: T.label }}>No items match the selected filter</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 10 }}>ITEM NAME</th>
                      <th style={{ ...thStyle, textAlign: 'center' }}>BASELINE</th>
                      {dateColumns.map((h, idx) => <th key={idx} style={{ ...thStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>{h.date}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item, idx) => (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                        <td style={{ ...tdStyle, position: 'sticky', left: 0, background: idx % 2 === 0 ? '#FFF' : T.tableAltRow, zIndex: 5, fontWeight: 500, color: T.body }}>{item.item_name}</td>
                        <td style={{ ...tdStyle, textAlign: 'center', color: T.body }}>{item.baseline_price != null ? `AED ${item.baseline_price.toFixed(2)}` : '—'}</td>
                        {item.history.slice(1).map((h, hidx) => {
                          const bl = item.baseline_price; const cur = h.price;
                          let color = T.body;
                          if (cur != null && bl != null) { if (cur > bl) color = T.priceUp; else if (cur < bl) color = T.priceDown; }
                          return <td key={hidx} style={{ ...tdStyle, textAlign: 'center', color, fontWeight: cur != null && bl != null && cur !== bl ? 600 : 400 }}>{cur != null ? `AED ${cur.toFixed(2)}` : '—'}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!hasBaseline || !dashboardData) {
    return (
      <div style={{ minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 600 }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <h1 style={{ fontSize: 40, fontWeight: 700, color: T.primary, margin: 0 }}>MENU PRICE TRACKER</h1>
            <p style={{ color: T.label, fontSize: 16, margin: '8px 0 0' }}>Talabat UAE | Competitive Pricing Intelligence</p>
          </div>
          {!hasBaseline && (
            <div style={{ ...cardStyle, padding: 24 }}>
              <h2 style={{ color: T.title, fontWeight: 600, fontSize: 18, margin: '0 0 8px' }}>Upload Master File (Baseline)</h2>
              <p style={{ color: T.label, fontSize: 13, margin: '0 0 16px' }}>Upload the Master Price Tracker xlsx file to set the baseline</p>
              <input type="text" placeholder="Baseline date (e.g., 24-Feb-25)" value={baselineDate} onChange={(e) => setBaselineDate(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 12, fontSize: 14, color: T.body }} />
              <input type="file" accept=".xlsx,.xls" onChange={(e) => setStagedMasterFile(e.target.files[0])} style={{ width: '100%', marginBottom: 12 }} />
              <button onClick={handleMasterUpload} disabled={!stagedMasterFile || uploading} style={{ ...headerBtnAccent, opacity: (!stagedMasterFile || uploading) ? 0.5 : 1, width: '100%', justifyContent: 'center', padding: '10px 16px' }}>
                <Upload size={14} /> {uploading ? 'Uploading...' : 'Upload Master File'}
              </button>
            </div>
          )}
          {hasBaseline && (
            <div style={{ ...cardStyle, padding: 24 }}>
              <h2 style={{ color: T.title, fontWeight: 600, fontSize: 18, margin: '0 0 8px' }}>Upload Scrape Data</h2>
              <p style={{ color: T.label, fontSize: 13, margin: '0 0 16px' }}>Upload your first scrape files to start tracking</p>
              <Select value={scrapeDate} onValueChange={setScrapeDate}>
                <SelectTrigger style={{ border: `1px solid ${T.border}`, borderRadius: 8, color: T.body, marginBottom: 12 }}><SelectValue placeholder="Select date" /></SelectTrigger>
                <SelectContent style={{ background: '#FFF', border: `1px solid ${T.border}`, color: T.body, maxHeight: 300 }}>{dateOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
              <input type="file" accept=".xlsx,.xls" multiple onChange={(e) => setStagedScrapeFiles(e.target.files)} style={{ width: '100%', marginBottom: 12 }} />
              <button onClick={handleScrapeUpload} disabled={!stagedScrapeFiles || !scrapeDate || uploading} style={{ ...headerBtnAccent, opacity: (!stagedScrapeFiles || !scrapeDate || uploading) ? 0.5 : 1, width: '100%', justifyContent: 'center', padding: '10px 16px' }}>
                <Upload size={14} /> {uploading ? 'Uploading...' : 'Upload Scrape Data'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const summaryTotals = calculateOwnBrandsTotals();

  return (
    <div style={{ minHeight: '100vh', background: T.bg, padding: 24 }}>
      <div style={{ ...cardStyle, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: T.primary, margin: 0 }}>MENU PRICE TRACKER</h1>
            <p style={{ color: T.label, fontSize: 13, margin: '4px 0 0' }}>Talabat UAE | Baseline: {baselineDate} | Latest: {dashboardData.latest_date}{dashboardData.previous_date && ` | Previous: ${dashboardData.previous_date}`}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={viewNpdTracker} style={headerBtnAccent}><Package size={14} /> NPD Tracker</button>
            <button onClick={viewAllHistory} style={headerBtnStyle}><RefreshCw size={14} /> View All History</button>
            <button onClick={() => setShowManageBrands(true)} style={headerBtnStyle}><Settings size={14} /> Manage Brands</button>
            <button onClick={() => setShowUploadModal(true)} style={headerBtnAccent}><Upload size={14} /> Upload Data</button>
            <button onClick={exportResults} style={headerBtnStyle}><Download size={14} /> Export</button>
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, padding: 16, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ color: T.label, fontSize: 13, fontWeight: 600 }}>Compare:</span>
          <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {['baseline', 'previous', 'date'].map((mode) => (
              <button key={mode} onClick={() => { setCompareMode(mode); if (mode !== 'date') setCompareDate(''); }}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderLeft: mode !== 'baseline' ? `1px solid ${T.border}` : 'none',
                  background: compareMode === mode ? T.accentBg : '#FFF', color: compareMode === mode ? T.primary : T.label }}>
                vs {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          {compareMode === 'date' && dashboardData.all_dates && (
            <Select value={compareDate} onValueChange={setCompareDate}>
              <SelectTrigger style={{ width: 200, border: `1px solid ${T.border}`, borderRadius: 8, color: T.body }}><SelectValue placeholder="Pick a date..." /></SelectTrigger>
              <SelectContent style={{ background: '#FFF', border: `1px solid ${T.border}`, color: T.body, maxHeight: 300 }}>
                {dashboardData.all_dates.filter(d => d !== dashboardData.latest_date).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <span style={{ color: T.label, fontSize: 12, marginLeft: 'auto' }}>{compareModeLabel()}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Price Up" value={summaryTotals.price_up} color={T.priceUp} />
        <KpiCard label="Price Down" value={summaryTotals.price_down} color={T.priceDown} />
        <KpiCard label="New Items" value={summaryTotals.new_items} color={T.newItem} />
        <KpiCard label="Removed" value={summaryTotals.removed} color={T.removed} />
        <KpiCard label="No Change" value={summaryTotals.no_change} color={T.noChange} />
        <KpiCard label="Total Items" value={summaryTotals.total} color={T.primary} />
      </div>

      {dashboardData.brands.some(b => b.latest_data?.ai_summary) && (
        <div style={{ ...cardStyle, marginBottom: 24 }}>
          <button onClick={() => toggleSummary('dashboard')} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, background: 'none', border: 'none', cursor: 'pointer' }}>
            <span style={{ color: T.title, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={16} color={T.accent} /> AI Summary — {dashboardData.latest_date}</span>
            {expandedSummaries['dashboard'] ? <ChevronDown size={16} color={T.label} /> : <ChevronRight size={16} color={T.label} />}
          </button>
          {expandedSummaries['dashboard'] && (
            <div style={{ padding: '0 16px 16px' }}>
              <div style={{ color: T.body, fontSize: 14, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{dashboardData.brands.find(b => b.latest_data?.ai_summary)?.latest_data.ai_summary}</div>
              <button onClick={() => regenerateSummary(dashboardData.latest_date)} style={{ ...headerBtnStyle, fontSize: 12, padding: '6px 12px' }}><RefreshCw size={12} /> Regenerate</button>
            </div>
          )}
        </div>
      )}

      <div style={{ ...cardStyle, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left' }}>BRAND</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>TYPE</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>UP</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>DN</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>NEW</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>REM</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>NC</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>TOTAL</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {brandGroups.map((group, groupIdx) => {
                const ownData = getBrandStats(group.own);
                let rowNum = 0;
                return (
                  <React.Fragment key={`group-${groupIdx}`}>
                    <tr style={{ background: 'rgba(0,107,107,0.04)' }}>
                      <td style={tdStyle}><span style={{ color: T.primary, marginRight: 4 }}>&#9733;</span><span style={{ fontWeight: 600, color: T.body }}>{group.own}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: T.ownBadgeBg, color: T.ownBadgeText }}>OWN</span></td>
                      <StatCell value={ownData.price_up} color={T.priceUp} bg="rgba(229,115,115,0.15)" />
                      <StatCell value={ownData.price_down} color={T.priceDown} bg="rgba(102,187,106,0.15)" />
                      <StatCell value={ownData.new_items} color={T.newItem} bg="rgba(66,165,245,0.15)" />
                      <StatCell value={ownData.removed} color={T.removed} bg="rgba(255,167,38,0.15)" />
                      <StatCell value={ownData.no_change} color={T.noChange} bg="rgba(189,189,189,0.15)" />
                      <td style={{ ...tdStyle, textAlign: 'center' }}><span style={{ color: T.primary, fontWeight: 600 }}>{ownData.total || 0}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><button onClick={() => viewBrandHistory(group.own)} style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>View History</button></td>
                    </tr>
                    {group.competitors.map((comp, compIdx) => {
                      rowNum++;
                      const compData = getBrandStats(comp);
                      return (
                        <tr key={`comp-${groupIdx}-${compIdx}`} style={{ background: rowNum % 2 === 0 ? '#FFF' : T.tableAltRow }}>
                          <td style={{ ...tdStyle, paddingLeft: 32 }}><span style={{ color: T.body }}>{comp}</span></td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}><span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: T.compBadgeBg, color: T.compBadgeText }}>COMP</span></td>
                          <StatCell value={compData.price_up} color={T.priceUp} bg="rgba(229,115,115,0.15)" />
                          <StatCell value={compData.price_down} color={T.priceDown} bg="rgba(102,187,106,0.15)" />
                          <StatCell value={compData.new_items} color={T.newItem} bg="rgba(66,165,245,0.15)" />
                          <StatCell value={compData.removed} color={T.removed} bg="rgba(255,167,38,0.15)" />
                          <StatCell value={compData.no_change} color={T.noChange} bg="rgba(189,189,189,0.15)" />
                          <td style={{ ...tdStyle, textAlign: 'center' }}><span style={{ color: T.primary, fontWeight: 600 }}>{compData.total || 0}</span></td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}><button onClick={() => viewBrandHistory(comp)} style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>View History</button></td>
                        </tr>
                      );
                    })}
                    {groupIdx < brandGroups.length - 1 && <tr><td colSpan="9" style={{ height: 6, background: T.divider }}></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50 }}>
          <div style={{ ...cardStyle, padding: 24, width: '100%', maxWidth: 600 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: T.title, margin: 0 }}>Upload Data</h2>
              <button onClick={() => setShowUploadModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.label }}><X size={20} /></button>
            </div>
            <div style={{ marginBottom: 20, padding: 16, background: T.tableAltRow, borderRadius: 10 }}>
              <h3 style={{ color: T.title, fontWeight: 600, fontSize: 15, margin: '0 0 8px' }}>Update Master File (Optional)</h3>
              <p style={{ color: T.label, fontSize: 13, margin: '0 0 12px' }}>Upload a new master file to update the baseline</p>
              <input type="text" placeholder="Baseline date" value={baselineDate} onChange={(e) => setBaselineDate(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 8, fontSize: 14, color: T.body }} />
              <input type="file" accept=".xlsx,.xls" onChange={(e) => setStagedMasterFile(e.target.files[0])} style={{ width: '100%', marginBottom: 12 }} />
              <button onClick={handleMasterUpload} disabled={!stagedMasterFile || uploading} style={{ ...headerBtnAccent, opacity: (!stagedMasterFile || uploading) ? 0.5 : 1, width: '100%', justifyContent: 'center', padding: '10px 16px' }}>
                <Upload size={14} /> {uploading ? 'Uploading...' : 'Upload Master'}
              </button>
            </div>
            <div style={{ padding: 16, background: T.tableAltRow, borderRadius: 10 }}>
              <h3 style={{ color: T.title, fontWeight: 600, fontSize: 15, margin: '0 0 8px' }}>Upload Scrape Data</h3>
              <p style={{ color: T.label, fontSize: 13, margin: '0 0 12px' }}>Upload scrape files for a specific date</p>
              <Select value={scrapeDate} onValueChange={setScrapeDate}>
                <SelectTrigger style={{ border: `1px solid ${T.border}`, borderRadius: 8, color: T.body, marginBottom: 8 }}><SelectValue placeholder="Select date" /></SelectTrigger>
                <SelectContent style={{ background: '#FFF', border: `1px solid ${T.border}`, color: T.body, maxHeight: 300 }}>{dateOptions.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
              <input type="file" accept=".xlsx,.xls" multiple onChange={(e) => setStagedScrapeFiles(e.target.files)} style={{ width: '100%', marginBottom: 8 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: T.label, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={setAsBaseline} onChange={(e) => setSetAsBaseline(e.target.checked)} /> Set as new baseline
              </label>
              <button onClick={handleScrapeUpload} disabled={!stagedScrapeFiles || !scrapeDate || uploading} style={{ ...headerBtnAccent, opacity: (!stagedScrapeFiles || !scrapeDate || uploading) ? 0.5 : 1, width: '100%', justifyContent: 'center', padding: '10px 16px' }}>
                <Upload size={14} /> {uploading ? 'Uploading...' : 'Upload Scrape'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showManageBrands && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 50 }}>
          <div style={{ ...cardStyle, padding: 24, width: '100%', maxWidth: 700, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: T.title, margin: 0 }}>Manage Brand Groups</h2>
              <button onClick={() => setShowManageBrands(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.label }}><X size={20} /></button>
            </div>
            <div style={{ marginBottom: 20, padding: 16, background: T.tableAltRow, borderRadius: 10 }}>
              <h3 style={{ color: T.title, fontWeight: 600, fontSize: 15, margin: '0 0 12px' }}>Add New Brand Group</h3>
              <input type="text" placeholder="Own brand name" value={newBrandOwn} onChange={(e) => setNewBrandOwn(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 8, fontSize: 14, color: T.body }} />
              <input type="text" placeholder="Competitors (comma-separated)" value={newBrandCompetitors} onChange={(e) => setNewBrandCompetitors(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 8, fontSize: 14, color: T.body }} />
              <button onClick={handleAddBrandGroup} style={{ ...headerBtnAccent, padding: '8px 16px' }}><Plus size={14} /> Add Group</button>
            </div>
            {brandGroups.map((group, idx) => (
              <div key={idx} style={{ ...cardStyle, padding: 16, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: T.body }}>{group.own}</span>
                    <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 10px', borderRadius: 12, background: T.ownBadgeBg, color: T.ownBadgeText, fontWeight: 600 }}>OWN</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => { setEditingBrand(group.own); setEditCompetitors(group.competitors.join(', ')); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.primary }}><Edit2 size={14} /></button>
                    <button onClick={() => handleDeleteBrandGroup(group.own)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.priceUp }}><Trash2 size={14} /></button>
                  </div>
                </div>
                {editingBrand === group.own ? (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <input type="text" value={editCompetitors} onChange={(e) => setEditCompetitors(e.target.value)}
                      style={{ flex: 1, padding: '6px 10px', border: `1px solid ${T.border}`, borderRadius: 8, fontSize: 13, color: T.body }} />
                    <button onClick={() => handleUpdateBrandGroup(group.own)} style={{ ...headerBtnAccent, padding: '6px 12px', fontSize: 12 }}><Save size={12} /> Save</button>
                  </div>
                ) : (
                  <div style={{ marginTop: 4, color: T.label, fontSize: 13 }}>
                    {group.competitors.length > 0 ? group.competitors.join(', ') : 'No competitors'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
