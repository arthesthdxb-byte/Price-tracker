import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Upload, RefreshCw, Download, AlertTriangle, X, TrendingUp, TrendingDown, Settings, ChevronDown, ChevronRight, Plus, Trash2, Edit2, Save } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';
import axios from 'axios';

const API = '/api';

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

const StatCell = ({ value, colorClass, bgClass }) => (
  <td className="text-center p-4">
    {value > 0 ? (
      <span className={`inline-block px-3 py-1 rounded-full ${bgClass} ${colorClass} text-sm font-semibold`}>{value}</span>
    ) : (
      <span className="text-gray-600">—</span>
    )}
  </td>
);

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

  // Dynamic brand groups from API
  const [brandGroups, setBrandGroups] = useState([]);
  // Comparison mode
  const [compareMode, setCompareMode] = useState('baseline');
  const [compareDate, setCompareDate] = useState('');
  const [compareData, setCompareData] = useState(null);
  // Brand history compare
  const [historyCompareMode, setHistoryCompareMode] = useState('baseline');
  // Manage brands
  const [showManageBrands, setShowManageBrands] = useState(false);
  const [newBrandOwn, setNewBrandOwn] = useState('');
  const [newBrandCompetitors, setNewBrandCompetitors] = useState('');
  const [editingBrand, setEditingBrand] = useState(null);
  const [editCompetitors, setEditCompetitors] = useState('');
  // AI summary
  const [expandedSummaries, setExpandedSummaries] = useState({});
  // Staged files for upload
  const [stagedMasterFile, setStagedMasterFile] = useState(null);
  const [stagedScrapeFiles, setStagedScrapeFiles] = useState(null);
  const [uploading, setUploading] = useState(false);

  const allBrands = useMemo(() => brandGroups.flatMap(g => [g.own, ...g.competitors]), [brandGroups]);

  useEffect(() => {
    checkBaseline();
    loadDashboard();
    loadBrandGroups();
  }, []);

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
    if (compareMode === 'date' && compareDate) {
      loadCompareData(compareDate);
    } else {
      setCompareData(null);
    }
  }, [compareMode, compareDate]);

  const loadCompareData = async (targetDate) => {
    try {
      const response = await axios.get(`${API}/compare/${encodeURIComponent(targetDate)}`);
      setCompareData(response.data);
    } catch (error) { console.error('Error loading comparison:', error); toast.error('Error loading comparison'); }
  };

  // Excel parsing
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
                const itemName = row[1]; const price = row[2];
                if (itemName && price !== undefined && price !== null && price !== '') {
                  const tn = String(itemName).trim(); const pp = parseFloat(price);
                  if (tn && !isNaN(pp)) items[tn] = pp;
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

  // Uploads
  const handleMasterUpload = async () => {
    if (!stagedMasterFile) return;
    setUploading(true);
    try {
      const brands = await parseExcelFile(stagedMasterFile);
      const response = await axios.post(`${API}/baseline`, { brands, baseline_date: baselineDate });
      if (response.data.success) {
        toast.success(`Master uploaded - ${response.data.brands_count} brands, ${response.data.items_count} items`);
        setHasBaseline(true); setShowUploadModal(false); setStagedMasterFile(null);
      }
    } catch (error) { console.error('Error uploading master:', error); toast.error('Error uploading master file'); }
    finally { setUploading(false); }
  };

  const handleScrapeUpload = async () => {
    if (!stagedScrapeFiles || stagedScrapeFiles.length === 0) return;
    if (!scrapeDate) { toast.error('Please select the scrape date'); return; }
    setUploading(true);
    try {
      const brands = await parseScrapeFiles(stagedScrapeFiles);
      const response = await axios.post(`${API}/scrape`, { scrape_date: scrapeDate, brands, set_as_baseline: setAsBaseline });
      if (response.data.success) {
        let msg = `Scrape uploaded - ${response.data.brands_count} brands analyzed`;
        if (setAsBaseline) msg += ' (Baseline updated)';
        if (response.data.new_baselines_created > 0) msg += ` (${response.data.new_baselines_created} new baselines)`;
        if (response.data.ai_summary) msg += ' + AI summary';
        toast.success(msg);
        await loadDashboard(); await checkBaseline(); await loadBrandGroups();
        setScrapeDate(''); setSetAsBaseline(false); setStagedScrapeFiles(null);
      }
    } catch (error) { console.error('Error uploading scrape:', error); toast.error(error.response?.data?.detail || 'Error uploading scrape'); }
    finally { setUploading(false); }
  };

  // Navigation
  const viewBrandHistory = async (brandName) => {
    try {
      const response = await axios.get(`${API}/brand-history/${encodeURIComponent(brandName)}`);
      setBrandHistory(response.data); setSelectedBrand(brandName); setHistoryCompareMode('baseline'); setViewMode('brand-history');
    } catch (error) { console.error('Error:', error); toast.error('Error loading brand history'); }
  };

  const viewItemsHistory = async (brandName) => {
    try {
      const response = await axios.get(`${API}/items/${encodeURIComponent(brandName)}`);
      setItemsHistory(response.data); setSelectedBrand(brandName); setItemFilter('all'); setViewMode('items-history');
    } catch (error) { console.error('Error:', error); toast.error('Error loading items history'); }
  };

  const viewAllHistory = async () => {
    try {
      const response = await axios.get(`${API}/all-history`);
      setAllHistory(response.data); setViewMode('all-history');
    } catch (error) { console.error('Error:', error); toast.error('Error loading all history'); }
  };

  // Brand CRUD
  const handleAddBrandGroup = async () => {
    if (!newBrandOwn.trim()) { toast.error('Enter an own brand name'); return; }
    try {
      const competitors = newBrandCompetitors.split(',').map(s => s.trim()).filter(Boolean);
      await axios.post(`${API}/brand-groups`, { own_brand: newBrandOwn.trim(), competitors, group_order: brandGroups.length + 1 });
      toast.success(`Added ${newBrandOwn.trim()}`); setNewBrandOwn(''); setNewBrandCompetitors('');
      await loadBrandGroups(); await loadDashboard();
    } catch (error) { console.error('Error:', error); toast.error('Error adding brand group'); }
  };

  const handleUpdateBrandGroup = async (ownBrand) => {
    try {
      const competitors = editCompetitors.split(',').map(s => s.trim()).filter(Boolean);
      await axios.put(`${API}/brand-groups/${encodeURIComponent(ownBrand)}`, { competitors });
      toast.success(`Updated ${ownBrand}`); setEditingBrand(null); await loadBrandGroups();
    } catch (error) { console.error('Error:', error); toast.error('Error updating brand group'); }
  };

  const handleDeleteBrandGroup = async (ownBrand) => {
    if (!window.confirm(`Delete ${ownBrand} and its competitor group?`)) return;
    try {
      await axios.delete(`${API}/brand-groups/${encodeURIComponent(ownBrand)}`);
      toast.success(`Deleted ${ownBrand}`); await loadBrandGroups(); await loadDashboard();
    } catch (error) { console.error('Error:', error); toast.error('Error deleting brand group'); }
  };

  // AI summary
  const toggleSummary = (key) => setExpandedSummaries(prev => ({ ...prev, [key]: !prev[key] }));

  const regenerateSummary = async (date) => {
    try {
      toast.info('Regenerating AI summary...');
      const response = await axios.post(`${API}/regenerate-summary/${encodeURIComponent(date)}`);
      if (response.data.success) { toast.success('AI summary regenerated'); await loadDashboard(); }
    } catch (error) { console.error('Error:', error); toast.error('Error regenerating summary'); }
  };

  // Export
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

  // Helpers
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

  // ========== ALL HISTORY VIEW ==========
  if (viewMode === 'all-history' && allHistory) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white mb-1" data-testid="all-history-title">All History Timeline</h1>
                <p className="text-gray-400 text-sm">Day-by-day summary across all own brands | Baseline: {baselineDate}</p>
              </div>
              <Button onClick={() => setViewMode('dashboard')} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-white hover:bg-white/10" data-testid="back-to-dashboard-button">
                <X className="w-4 h-4 mr-2" /> Back
              </Button>
            </div>
          </div>
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4"><div className="text-gray-400 text-sm mb-1">Total Dates</div><div className="text-white text-2xl font-bold">{allHistory.dates_summary.length}</div></div>
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4"><div className="text-gray-400 text-sm mb-1">Latest Upload</div><div className="text-green-400 text-2xl font-bold">{allHistory.latest_date}</div></div>
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4"><div className="text-gray-400 text-sm mb-1">Brands Tracked</div><div className="text-blue-400 text-2xl font-bold">{allHistory.total_brands}</div></div>
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4"><div className="text-gray-400 text-sm mb-1">Own Brands</div><div className="text-green-400 text-2xl font-bold">{allHistory.own_brands_count}</div></div>
          </div>
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                    <th className="text-left p-4 text-gray-400 font-semibold text-sm">DATE</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">BRANDS</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">UP</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">DOWN</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">NEW</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">REMOVED</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">NO CHG</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">TOTAL</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">CHG%</th>
                  </tr>
                </thead>
                <tbody>
                  {allHistory.dates_summary.map((dd, idx) => {
                    const cp = dd.total_items > 0 ? ((dd.total_price_up + dd.total_price_down) / dd.total_items) * 100 : 0;
                    return (
                      <tr key={idx} className="border-b border-[#1a1a1f] hover:bg-white/5" data-testid={`history-date-row-${idx}`}>
                        <td className="p-4"><div className="flex items-center gap-2"><span className="text-white font-semibold">{dd.date}</span>{dd.date === allHistory.latest_date && <span className="inline-block px-2 py-1 rounded-full bg-green-400/20 text-green-400 text-xs font-semibold">Latest</span>}</div></td>
                        <td className="text-center p-4 text-gray-300">{dd.brands_count}</td>
                        <StatCell value={dd.total_price_up} colorClass="text-green-400" bgClass="bg-green-400/20" />
                        <StatCell value={dd.total_price_down} colorClass="text-red-400" bgClass="bg-red-400/20" />
                        <StatCell value={dd.total_new_items} colorClass="text-cyan-400" bgClass="bg-cyan-400/20" />
                        <StatCell value={dd.total_removed} colorClass="text-purple-400" bgClass="bg-purple-400/20" />
                        <StatCell value={dd.total_no_change} colorClass="text-gray-400" bgClass="bg-gray-400/20" />
                        <td className="text-center p-4"><span className="text-blue-400 font-semibold">{dd.total_items}</span></td>
                        <td className="text-center p-4"><span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${cp > 50 ? 'bg-red-400/20 text-red-400' : cp > 20 ? 'bg-yellow-400/20 text-yellow-400' : 'bg-green-400/20 text-green-400'}`}>{cp.toFixed(1)}%</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-center mt-6 text-gray-500 text-sm">All comparisons vs. Baseline ({baselineDate})</div>
        </div>
      </div>
    );
  }

  // ========== BRAND HISTORY VIEW ==========
  if (viewMode === 'brand-history' && brandHistory) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white mb-1" data-testid="brand-history-title">{selectedBrand}</h1>
                <p className="text-gray-400 text-sm">Day-wise Price Change History</p>
              </div>
              <div className="flex gap-3 items-center">
                <div className="flex bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg overflow-hidden">
                  <button onClick={() => setHistoryCompareMode('baseline')} className={`px-3 py-2 text-xs font-semibold transition-colors ${historyCompareMode === 'baseline' ? 'bg-green-400/20 text-green-400' : 'text-gray-400 hover:text-white'}`}>vs Baseline</button>
                  <button onClick={() => setHistoryCompareMode('previous')} className={`px-3 py-2 text-xs font-semibold transition-colors ${historyCompareMode === 'previous' ? 'bg-purple-400/20 text-purple-400' : 'text-gray-400 hover:text-white'}`}>vs Previous</button>
                </div>
                <Button onClick={() => viewItemsHistory(selectedBrand)} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-cyan-400 hover:bg-cyan-400/10" data-testid="view-items-button">View Items</Button>
                <Button onClick={() => setViewMode('dashboard')} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-white hover:bg-white/10" data-testid="back-to-dashboard-button"><X className="w-4 h-4 mr-2" /> Back</Button>
              </div>
            </div>
          </div>
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                    <th className="text-left p-4 text-gray-400 font-semibold text-sm">DATE</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">UP</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">DOWN</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">NEW</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">REM</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">NC</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">TOTAL</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">CHG%</th>
                  </tr>
                </thead>
                <tbody>
                  {brandHistory.history.map((item, idx) => {
                    const stats = historyCompareMode === 'previous' && item.vs_previous ? item.vs_previous : (item.vs_baseline || item);
                    return (
                      <tr key={idx} className="border-b border-[#1a1a1f] hover:bg-white/5" data-testid={`history-row-${idx}`}>
                        <td className="p-4"><div className="flex flex-col gap-1"><span className="text-white font-semibold">{item.date}</span>{historyCompareMode === 'previous' && !item.vs_previous && <span className="text-gray-500 text-xs">No previous data</span>}</div></td>
                        <StatCell value={stats.price_up} colorClass="text-green-400" bgClass="bg-green-400/20" />
                        <StatCell value={stats.price_down} colorClass="text-red-400" bgClass="bg-red-400/20" />
                        <StatCell value={stats.new_items} colorClass="text-cyan-400" bgClass="bg-cyan-400/20" />
                        <StatCell value={stats.removed} colorClass="text-purple-400" bgClass="bg-purple-400/20" />
                        <StatCell value={stats.no_change} colorClass="text-gray-400" bgClass="bg-gray-400/20" />
                        <td className="text-center p-4"><span className="text-blue-400 font-semibold">{stats.total || 0}</span></td>
                        <td className="text-center p-4"><span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${(stats.change_percent||0) > 50 ? 'bg-red-400/20 text-red-400' : (stats.change_percent||0) > 20 ? 'bg-yellow-400/20 text-yellow-400' : 'bg-green-400/20 text-green-400'}`}>{(stats.change_percent||0).toFixed(1)}%</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {brandHistory.history.some(h => h.ai_summary) && (
            <div className="mt-6 space-y-3">
              <h3 className="text-white font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-purple-400" /> AI Summaries</h3>
              {brandHistory.history.filter(h => h.ai_summary).map((item, idx) => (
                <div key={idx} className="bg-[#101014] border border-[#1a1a1f] rounded-lg">
                  <button onClick={() => toggleSummary(`bh-${item.date}`)} className="w-full flex items-center justify-between p-4 text-left">
                    <span className="text-gray-300 text-sm font-semibold">{item.date}</span>
                    {expandedSummaries[`bh-${item.date}`] ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </button>
                  {expandedSummaries[`bh-${item.date}`] && <div className="px-4 pb-4 text-gray-400 text-sm whitespace-pre-wrap">{item.ai_summary}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========== ITEMS HISTORY VIEW ==========
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

    return (
      <div className="min-h-screen bg-[#0b0b0f] p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white mb-1" data-testid="items-history-title">{selectedBrand}</h1>
                <p className="text-gray-400 text-sm">Item-wise Price History | Baseline: {itemsHistory.baseline_date}</p>
              </div>
              <Button onClick={() => setViewMode('dashboard')} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-white hover:bg-white/10" data-testid="back-button"><X className="w-4 h-4 mr-2" /> Back</Button>
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              <Button onClick={() => setItemFilter('all')} variant={itemFilter === 'all' ? 'default' : 'outline'} className={itemFilter === 'all' ? 'bg-green-400 text-black hover:bg-green-500' : 'bg-[#0b0b0f] border-[#1a1a1f] text-gray-400 hover:bg-white/10'} data-testid="filter-all">All Items ({totalItems})</Button>
              <Button onClick={() => setItemFilter('added')} variant={itemFilter === 'added' ? 'default' : 'outline'} className={itemFilter === 'added' ? 'bg-cyan-400 text-black hover:bg-cyan-500' : 'bg-[#0b0b0f] border-[#1a1a1f] text-cyan-400 hover:bg-cyan-400/10'} data-testid="filter-added">Added Items</Button>
              <Button onClick={() => setItemFilter('increased')} variant={itemFilter === 'increased' ? 'default' : 'outline'} className={itemFilter === 'increased' ? 'bg-green-400 text-black hover:bg-green-500' : 'bg-[#0b0b0f] border-[#1a1a1f] text-green-400 hover:bg-green-400/10'} data-testid="filter-increased">Price Increased</Button>
              <Button onClick={() => setItemFilter('decreased')} variant={itemFilter === 'decreased' ? 'default' : 'outline'} className={itemFilter === 'decreased' ? 'bg-red-400 text-black hover:bg-red-500' : 'bg-[#0b0b0f] border-[#1a1a1f] text-red-400 hover:bg-red-400/10'} data-testid="filter-decreased">Price Decreased</Button>
            </div>
            {filteredItems.length === 0 && <div className="text-center py-8 text-gray-500">No items match the selected filter</div>}
          </div>
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden">
            {filteredItems.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                      <th className="text-left p-4 text-gray-400 font-semibold text-sm sticky left-0 bg-[#0b0b0f] z-10">ITEM NAME</th>
                      <th className="text-center p-4 text-gray-400 font-semibold text-sm">BASELINE</th>
                      {dateColumns.map((h, idx) => <th key={idx} className="text-center p-4 text-gray-400 font-semibold text-sm whitespace-nowrap">{h.date}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item, idx) => {
                      const hasChanges = item.history.some((h, i) => i > 0 && h.price !== item.baseline_price && h.price !== null);
                      return (
                        <tr key={idx} className="border-b border-[#1a1a1f] hover:bg-white/5" data-testid={`item-row-${idx}`}>
                          <td className="p-4 text-white sticky left-0 bg-[#101014] z-10">
                            <div className="flex items-center gap-2">{hasChanges && <TrendingUp className="w-4 h-4 text-yellow-400" />}{item.item_name}</div>
                          </td>
                          <td className="text-center p-4 text-gray-300">{item.baseline_price != null ? `AED ${item.baseline_price.toFixed(2)}` : '-'}</td>
                          {item.history.slice(1).map((h, hidx) => {
                            const bl = item.baseline_price; const cur = h.price;
                            let cc = 'text-gray-300';
                            if (cur != null && bl != null) { if (cur > bl) cc = 'text-green-400 font-semibold'; else if (cur < bl) cc = 'text-red-400 font-semibold'; }
                            return <td key={hidx} className={`text-center p-4 ${cc}`}>{cur != null ? `AED ${cur.toFixed(2)}` : '-'}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ========== SETUP VIEW ==========
  if (!hasBaseline || !dashboardData) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center p-6" data-testid="setup-section">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-5xl font-bold text-green-400" data-testid="app-title">MENU PRICE TRACKER</h1>
            <p className="text-gray-400 text-lg" data-testid="app-subtitle">Talabat UAE | Competitive Pricing Intelligence</p>
          </div>
          {!hasBaseline && (
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 space-y-4">
              <h2 className="text-xl font-semibold text-white">Upload Master File (Baseline)</h2>
              <p className="text-gray-400 text-sm">Upload the Master Price Tracker xlsx file to set the baseline</p>
              <Input type="text" placeholder="Baseline date (e.g., 24-Feb-25)" value={baselineDate} onChange={(e) => setBaselineDate(e.target.value)} className="bg-[#0b0b0f] border-[#1a1a1f] text-white placeholder:text-gray-500 mb-3" data-testid="baseline-date-input" />
              <Input type="file" accept=".xlsx,.xls" onChange={(e) => setStagedMasterFile(e.target.files[0] || null)} className="bg-[#0b0b0f] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20" data-testid="master-file-input" />
              {stagedMasterFile && <Button onClick={handleMasterUpload} disabled={uploading} className="bg-green-400 text-black hover:bg-green-500 w-full mt-2" data-testid="upload-master-button">{uploading ? 'Uploading...' : `Upload ${stagedMasterFile.name}`}</Button>}
            </div>
          )}
          {hasBaseline && (
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 space-y-4">
              <h2 className="text-xl font-semibold text-white">Upload Scrape Data</h2>
              <p className="text-gray-400 text-sm">Upload your first scrape files to start tracking</p>
              <Select value={scrapeDate} onValueChange={setScrapeDate}>
                <SelectTrigger className="bg-[#0b0b0f] border-[#1a1a1f] text-white" data-testid="scrape-date-select"><SelectValue placeholder="Select date" /></SelectTrigger>
                <SelectContent className="bg-[#0b0b0f] border-[#1a1a1f] text-white max-h-[300px]">{dateOptions.map((d) => <SelectItem key={d} value={d} className="text-white hover:bg-green-400/10">{d}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="file" accept=".xlsx,.xls" multiple onChange={(e) => setStagedScrapeFiles(e.target.files.length > 0 ? e.target.files : null)} className="bg-[#0b0b0f] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20" data-testid="scrape-files-input" />
              {stagedScrapeFiles && <Button onClick={handleScrapeUpload} disabled={uploading} className="bg-green-400 text-black hover:bg-green-500 w-full mt-2" data-testid="upload-scrape-button">{uploading ? 'Uploading...' : `Upload ${stagedScrapeFiles.length} file${stagedScrapeFiles.length > 1 ? 's' : ''}`}</Button>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ========== MAIN DASHBOARD ==========
  const summaryTotals = calculateOwnBrandsTotals();

  return (
    <div className="min-h-screen bg-[#0b0b0f] p-6" data-testid="dashboard-section">
      {/* Header */}
      <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6" data-testid="dashboard-header">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-green-400 mb-1" data-testid="dashboard-title">MENU PRICE TRACKER</h1>
            <p className="text-gray-400 text-sm" data-testid="dashboard-subtitle">Talabat UAE | Baseline: {baselineDate} | Latest: {dashboardData.latest_date}{dashboardData.previous_date && ` | Previous: ${dashboardData.previous_date}`}</p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button onClick={viewAllHistory} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-purple-400 hover:bg-purple-400/10" data-testid="view-all-history-button">View All History</Button>
            <Button onClick={() => setShowManageBrands(true)} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-yellow-400 hover:bg-yellow-400/10"><Settings className="w-4 h-4 mr-2" /> Manage Brands</Button>
            <Button onClick={() => setShowUploadModal(true)} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-cyan-400 hover:bg-cyan-400/10" data-testid="upload-data-button"><Upload className="w-4 h-4 mr-2" /> Upload Data</Button>
            <Button onClick={exportResults} variant="outline" className="bg-[#0b0b0f] border-[#1a1a1f] text-green-400 hover:bg-green-400/10" data-testid="export-button"><Download className="w-4 h-4 mr-2" /> Export</Button>
          </div>
        </div>
      </div>

      {/* Comparison Toggle */}
      <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4 mb-6">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-gray-400 text-sm font-semibold">Compare:</span>
          <div className="flex bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg overflow-hidden">
            <button onClick={() => { setCompareMode('baseline'); setCompareDate(''); }} className={`px-4 py-2 text-xs font-semibold transition-colors ${compareMode === 'baseline' ? 'bg-green-400/20 text-green-400' : 'text-gray-400 hover:text-white'}`}>vs Baseline</button>
            <button onClick={() => { setCompareMode('previous'); setCompareDate(''); }} className={`px-4 py-2 text-xs font-semibold transition-colors ${compareMode === 'previous' ? 'bg-purple-400/20 text-purple-400' : 'text-gray-400 hover:text-white'}`}>vs Previous</button>
            <button onClick={() => setCompareMode('date')} className={`px-4 py-2 text-xs font-semibold transition-colors ${compareMode === 'date' ? 'bg-cyan-400/20 text-cyan-400' : 'text-gray-400 hover:text-white'}`}>vs Date</button>
          </div>
          {compareMode === 'date' && dashboardData.all_dates && (
            <Select value={compareDate} onValueChange={setCompareDate}>
              <SelectTrigger className="bg-[#0b0b0f] border-[#1a1a1f] text-white w-[200px]"><SelectValue placeholder="Pick a date..." /></SelectTrigger>
              <SelectContent className="bg-[#0b0b0f] border-[#1a1a1f] text-white max-h-[300px]">
                {dashboardData.all_dates.filter(d => d !== dashboardData.latest_date).map((d) => <SelectItem key={d} value={d} className="text-white hover:bg-cyan-400/10">{d}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <span className="text-gray-500 text-xs ml-auto">{compareModeLabel()}</span>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6" data-testid="since-baseline-section">
          <h3 className="text-white font-semibold mb-4">{compareModeLabel()}</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#0b0b0f] rounded-lg p-3 border border-green-400/30"><div className="text-green-400 text-xl font-bold">{summaryTotals.price_up}</div><div className="text-gray-400 text-xs mt-1">Price Up</div></div>
            <div className="bg-[#0b0b0f] rounded-lg p-3 border border-red-400/30"><div className="text-red-400 text-xl font-bold">{summaryTotals.price_down}</div><div className="text-gray-400 text-xs mt-1">Price Down</div></div>
            <div className="bg-[#0b0b0f] rounded-lg p-3 border border-cyan-400/30"><div className="text-cyan-400 text-xl font-bold">{summaryTotals.new_items}</div><div className="text-gray-400 text-xs mt-1">New</div></div>
          </div>
        </div>
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 grid grid-cols-3 gap-3">
          <div className="bg-[#0b0b0f] rounded-lg p-3 border border-purple-400/30"><div className="text-purple-400 text-xl font-bold">{summaryTotals.removed}</div><div className="text-gray-400 text-xs mt-1">Removed</div></div>
          <div className="bg-[#0b0b0f] rounded-lg p-3 border border-gray-400/30"><div className="text-gray-400 text-xl font-bold">{summaryTotals.no_change}</div><div className="text-gray-400 text-xs mt-1">No Change</div></div>
          <div className="bg-[#0b0b0f] rounded-lg p-3 border border-blue-400/30"><div className="text-blue-400 text-xl font-bold">{summaryTotals.total}</div><div className="text-gray-400 text-xs mt-1">Total Items</div></div>
        </div>
      </div>

      {/* AI Summary */}
      {dashboardData.brands.some(b => b.latest_data?.ai_summary) && (
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg mb-6">
          <button onClick={() => toggleSummary('dashboard')} className="w-full flex items-center justify-between p-4">
            <span className="text-white font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-purple-400" /> AI Summary - {dashboardData.latest_date}</span>
            {expandedSummaries['dashboard'] ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </button>
          {expandedSummaries['dashboard'] && (
            <div className="px-4 pb-4">
              <div className="text-gray-400 text-sm whitespace-pre-wrap mb-3">{dashboardData.brands.find(b => b.latest_data?.ai_summary)?.latest_data.ai_summary}</div>
              <Button onClick={() => regenerateSummary(dashboardData.latest_date)} variant="outline" size="sm" className="bg-[#0b0b0f] border-[#1a1a1f] text-purple-400 hover:bg-purple-400/10"><RefreshCw className="w-3 h-3 mr-2" /> Regenerate</Button>
            </div>
          )}
        </div>
      )}

      {/* Brand Table */}
      <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden" data-testid="brand-table">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                <th className="text-left p-4 text-gray-400 font-semibold text-sm">BRAND</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">TYPE</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">UP</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">DN</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">NEW</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">REM</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">NC</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">TOTAL</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {brandGroups.map((group, groupIdx) => {
                const ownData = getBrandStats(group.own);
                return (
                  <React.Fragment key={`group-${groupIdx}`}>
                    <tr className="border-b border-[#1a1a1f] bg-green-400/5 hover:bg-green-400/10" data-testid={`brand-row-own-${groupIdx}`}>
                      <td className="p-4"><div className="flex items-center gap-2"><span className="text-green-400">*</span><span className="text-white font-semibold">{group.own}</span></div></td>
                      <td className="text-center p-4"><span className="inline-block px-2 py-1 rounded-full bg-green-400/20 text-green-400 text-xs font-semibold">OWN</span></td>
                      <StatCell value={ownData.price_up} colorClass="text-green-400" bgClass="bg-green-400/20" />
                      <StatCell value={ownData.price_down} colorClass="text-red-400" bgClass="bg-red-400/20" />
                      <StatCell value={ownData.new_items} colorClass="text-cyan-400" bgClass="bg-cyan-400/20" />
                      <StatCell value={ownData.removed} colorClass="text-purple-400" bgClass="bg-purple-400/20" />
                      <StatCell value={ownData.no_change} colorClass="text-gray-400" bgClass="bg-gray-400/20" />
                      <td className="text-center p-4"><span className="text-blue-400 font-semibold">{ownData.total || 0}</span></td>
                      <td className="text-center p-4"><Button onClick={() => viewBrandHistory(group.own)} variant="ghost" size="sm" className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10" data-testid={`view-history-${groupIdx}`}>View History</Button></td>
                    </tr>
                    {group.competitors.map((comp, compIdx) => {
                      const compData = getBrandStats(comp);
                      return (
                        <tr key={`comp-${groupIdx}-${compIdx}`} className="border-b border-[#1a1a1f] hover:bg-white/5" data-testid={`brand-row-comp-${groupIdx}-${compIdx}`}>
                          <td className="p-4 pl-8"><span className="text-gray-300">{comp}</span></td>
                          <td className="text-center p-4"><span className="inline-block px-2 py-1 rounded-full bg-gray-600/20 text-gray-400 text-xs font-semibold">COMP</span></td>
                          <StatCell value={compData.price_up} colorClass="text-green-400" bgClass="bg-green-400/20" />
                          <StatCell value={compData.price_down} colorClass="text-red-400" bgClass="bg-red-400/20" />
                          <StatCell value={compData.new_items} colorClass="text-cyan-400" bgClass="bg-cyan-400/20" />
                          <StatCell value={compData.removed} colorClass="text-purple-400" bgClass="bg-purple-400/20" />
                          <StatCell value={compData.no_change} colorClass="text-gray-400" bgClass="bg-gray-400/20" />
                          <td className="text-center p-4"><span className="text-blue-400 font-semibold">{compData.total || 0}</span></td>
                          <td className="text-center p-4"><Button onClick={() => viewBrandHistory(comp)} variant="ghost" size="sm" className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10" data-testid={`view-comp-history-${groupIdx}-${compIdx}`}>View History</Button></td>
                        </tr>
                      );
                    })}
                    {groupIdx < brandGroups.length - 1 && <tr key={`sep-${groupIdx}`}><td colSpan="9" className="h-2 bg-[#0b0b0f]"></td></tr>}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50" data-testid="upload-modal">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 w-full max-w-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Upload Data</h2>
              <Button onClick={() => setShowUploadModal(false)} variant="ghost" size="sm" className="text-gray-400 hover:text-white" data-testid="close-modal-button"><X className="w-5 h-5" /></Button>
            </div>
            <div className="space-y-6">
              <div className="bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg p-4 space-y-3">
                <h3 className="text-white font-semibold">Update Master File (Optional)</h3>
                <p className="text-gray-400 text-sm">Upload a new master file to update the baseline</p>
                <Input type="text" placeholder="Baseline date" value={baselineDate} onChange={(e) => setBaselineDate(e.target.value)} className="bg-[#101014] border-[#1a1a1f] text-white placeholder:text-gray-500" data-testid="modal-baseline-date-input" />
                <Input type="file" accept=".xlsx,.xls" onChange={(e) => setStagedMasterFile(e.target.files[0] || null)} className="bg-[#101014] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20" data-testid="modal-master-file-input" />
                {stagedMasterFile && <Button onClick={handleMasterUpload} disabled={uploading} className="bg-green-400 text-black hover:bg-green-500 w-full" data-testid="modal-upload-master-button">{uploading ? 'Uploading...' : `Upload ${stagedMasterFile.name}`}</Button>}
              </div>
              <div className="bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg p-4 space-y-3">
                <h3 className="text-white font-semibold">Upload Scrape Data</h3>
                <p className="text-gray-400 text-sm">Upload scrape files for a specific date</p>
                <Select value={scrapeDate} onValueChange={setScrapeDate}>
                  <SelectTrigger className="bg-[#101014] border-[#1a1a1f] text-white" data-testid="modal-scrape-date-select"><SelectValue placeholder="Select date" /></SelectTrigger>
                  <SelectContent className="bg-[#0b0b0f] border-[#1a1a1f] text-white max-h-[300px]">{dateOptions.map((d) => <SelectItem key={d} value={d} className="text-white hover:bg-green-400/10">{d}</SelectItem>)}</SelectContent>
                </Select>
                <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <input type="checkbox" id="set-as-baseline" checked={setAsBaseline} onChange={(e) => setSetAsBaseline(e.target.checked)} className="w-4 h-4 rounded border-yellow-500/50 bg-[#101014] text-yellow-400 focus:ring-yellow-400 cursor-pointer" data-testid="set-as-baseline-checkbox" />
                  <label htmlFor="set-as-baseline" className="text-yellow-400 text-sm font-medium cursor-pointer">Also update baseline with this data</label>
                </div>
                {setAsBaseline && <p className="text-yellow-400 text-xs">This will replace the current baseline with data from the selected date.</p>}
                <Input type="file" accept=".xlsx,.xls" multiple onChange={(e) => setStagedScrapeFiles(e.target.files.length > 0 ? e.target.files : null)} className="bg-[#101014] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20" data-testid="modal-scrape-files-input" />
                {stagedScrapeFiles && <Button onClick={handleScrapeUpload} disabled={uploading} className="bg-green-400 text-black hover:bg-green-500 w-full" data-testid="modal-upload-scrape-button">{uploading ? 'Uploading...' : `Upload ${stagedScrapeFiles.length} file${stagedScrapeFiles.length > 1 ? 's' : ''}`}</Button>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Brands Modal */}
      {showManageBrands && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 w-full max-w-3xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white">Manage Brand Groups</h2>
              <Button onClick={() => setShowManageBrands(false)} variant="ghost" size="sm" className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></Button>
            </div>
            <div className="bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg p-4 mb-6 space-y-3">
              <h3 className="text-green-400 font-semibold text-sm">Add New Brand Group</h3>
              <Input type="text" placeholder="Own brand name (e.g., Shake Shack)" value={newBrandOwn} onChange={(e) => setNewBrandOwn(e.target.value)} className="bg-[#101014] border-[#1a1a1f] text-white placeholder:text-gray-500" />
              <Input type="text" placeholder="Competitors (comma-separated)" value={newBrandCompetitors} onChange={(e) => setNewBrandCompetitors(e.target.value)} className="bg-[#101014] border-[#1a1a1f] text-white placeholder:text-gray-500" />
              <Button onClick={handleAddBrandGroup} className="bg-green-400 text-black hover:bg-green-500"><Plus className="w-4 h-4 mr-2" /> Add Brand Group</Button>
            </div>
            <div className="space-y-3">
              {brandGroups.map((group, idx) => (
                <div key={idx} className="bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-white font-semibold flex items-center gap-2"><span className="text-green-400">*</span> {group.own}</span>
                    <div className="flex gap-2">
                      {editingBrand === group.own ? (
                        <Button onClick={() => handleUpdateBrandGroup(group.own)} size="sm" className="bg-green-400 text-black hover:bg-green-500"><Save className="w-3 h-3 mr-1" /> Save</Button>
                      ) : (
                        <Button onClick={() => { setEditingBrand(group.own); setEditCompetitors(group.competitors.join(', ')); }} variant="ghost" size="sm" className="text-yellow-400 hover:bg-yellow-400/10"><Edit2 className="w-3 h-3" /></Button>
                      )}
                      <Button onClick={() => handleDeleteBrandGroup(group.own)} variant="ghost" size="sm" className="text-red-400 hover:bg-red-400/10"><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>
                  {editingBrand === group.own ? (
                    <Input type="text" value={editCompetitors} onChange={(e) => setEditCompetitors(e.target.value)} className="bg-[#101014] border-[#1a1a1f] text-white text-sm" placeholder="Competitors (comma-separated)" />
                  ) : (
                    <div className="text-gray-400 text-sm">{group.competitors.length > 0 ? group.competitors.join(' | ') : 'No competitors'}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="text-center mt-6 text-gray-500 text-sm">COMPETITIVE PRICING INTELLIGENCE | TALABAT UAE</div>
    </div>
  );
};

export default Dashboard;
