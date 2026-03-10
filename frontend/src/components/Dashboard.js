import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Upload, RefreshCw, Download, AlertTriangle, X, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const BRAND_GROUPS = [
  { own: 'Operational Falafel', competitors: ['Zaatar w Zeit', 'Aloo Beirut'] },
  { own: 'Sushi DO', competitors: ['Sushi Buzz', 'Sushi Art'] },
  { own: 'Right Bite', competitors: ['The 500 Calorie Project', 'Kcal'] },
  { own: 'Chin Chin', competitors: ['Mandarin Oak', 'China Bistro'] },
  { own: 'Taqado', competitors: ['Tortilla', 'Chipotle'] },
  { own: 'Pizzaro', competitors: ['Pizza di Rocco', 'Oregano'] },
  { own: 'Biryani Pot', competitors: ['Gazebo', 'Art of Dum'] },
  { own: 'Luca', competitors: ['Pasta Della Nonna', 'The Pasta Cup'] },
  { own: 'High Joint', competitors: ['Just Burger', 'Krush Burger'] },
  { own: 'Hot Bun Sliders', competitors: ['Slider Stop'] },
  { own: 'Awani', competitors: ['Bait Maryam', 'Al Safadi'] },
  { own: 'Zaroob', competitors: ['Allo Beirut', 'Barbar'] },
  { own: 'Circle Cafe', competitors: ['LDC', 'Jones the Grocer'] },
];

const ALL_BRANDS = BRAND_GROUPS.flatMap(g => [g.own, ...g.competitors]);

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
  const [viewMode, setViewMode] = useState('dashboard'); // 'dashboard', 'brand-history', 'items-history', 'all-history'

  useEffect(() => {
    checkBaseline();
    loadDashboard();
  }, []);

  const checkBaseline = async () => {
    try {
      const response = await axios.get(`${API}/baseline`);
      setHasBaseline(response.data.exists);
      if (response.data.baseline_date) {
        setBaselineDate(response.data.baseline_date);
      }
    } catch (error) {
      console.error('Error checking baseline:', error);
    }
  };

  const loadDashboard = async () => {
    try {
      const response = await axios.get(`${API}/dashboard`);
      if (response.data.has_data) {
        setDashboardData(response.data);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    }
  };

  const parseExcelFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: 'array' });

          const brands = {};
          const skipKeywords = [
            'Executive Summary',
            'Price History',
            'Trend Data',
            'Price Increases',
            'Price Decreases',
          ];

          workbook.SheetNames.forEach((sheetName) => {
            const shouldSkip = skipKeywords.some((keyword) =>
              sheetName.includes(keyword)
            );
            if (shouldSkip) return;

            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

            const items = {};
            for (let i = 5; i < Math.min(605, jsonData.length); i++) {
              const row = jsonData[i];
              if (!row) continue;

              const itemName = row[6];
              const price = row[7];

              if (itemName && price !== undefined && price !== null && price !== '') {
                const trimmedName = String(itemName).trim();
                const parsedPrice = parseFloat(price);
                if (trimmedName && !isNaN(parsedPrice)) {
                  items[trimmedName] = parsedPrice;
                }
              }
            }

            if (Object.keys(items).length > 0) {
              brands[sheetName] = items;
            }
          });

          resolve(brands);
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  };

  const parseScrapeFiles = (files) => {
    return new Promise((resolve, reject) => {
      const brands = {};
      let filesProcessed = 0;

      const processFile = (file) => {
        return new Promise((resolveFile) => {
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
                  const row = jsonData[i];
                  if (!row) continue;

                  const itemName = row[1];
                  const price = row[2];

                  if (itemName && price !== undefined && price !== null && price !== '') {
                    const trimmedName = String(itemName).trim();
                    const parsedPrice = parseFloat(price);
                    if (trimmedName && !isNaN(parsedPrice)) {
                      items[trimmedName] = parsedPrice;
                    }
                  }
                }

                if (Object.keys(items).length > 0) {
                  brands[sheetName] = items;
                }
              });
              resolveFile();
            } catch (error) {
              console.error('Error parsing scrape file:', error);
              resolveFile();
            }
          };
          reader.readAsArrayBuffer(file);
        });
      };

      const promises = [];
      for (let i = 0; i < files.length; i++) {
        promises.push(processFile(files[i]));
      }

      Promise.all(promises).then(() => {
        resolve(brands);
      });
    });
  };

  const handleMasterUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const brands = await parseExcelFile(file);
      
      const response = await axios.post(`${API}/baseline`, {
        brands,
        baseline_date: baselineDate
      });

      if (response.data.success) {
        toast.success(`✓ Master uploaded — ${response.data.brands_count} brands, ${response.data.items_count} items`);
        setHasBaseline(true);
        setShowUploadModal(false);
      }
    } catch (error) {
      console.error('Error uploading master:', error);
      toast.error('Error uploading master file');
    }
  };

  const handleScrapeUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!scrapeDate) {
      toast.error('Please enter the scrape date');
      return;
    }

    try {
      const brands = await parseScrapeFiles(files);
      
      const response = await axios.post(`${API}/scrape`, {
        scrape_date: scrapeDate,
        brands
      });

      if (response.data.success) {
        toast.success(`✓ Scrape uploaded — ${response.data.brands_count} brands analyzed`);
        await loadDashboard();
        setScrapeDate('');
      }
    } catch (error) {
      console.error('Error uploading scrape:', error);
      toast.error(error.response?.data?.detail || 'Error uploading scrape files');
    }
  };

  const viewBrandHistory = async (brandName) => {
    try {
      const response = await axios.get(`${API}/brand-history/${encodeURIComponent(brandName)}`);
      setBrandHistory(response.data);
      setSelectedBrand(brandName);
      setViewMode('brand-history');
    } catch (error) {
      console.error('Error loading brand history:', error);
      toast.error('Error loading brand history');
    }
  };

  const viewItemsHistory = async (brandName) => {
    try {
      const response = await axios.get(`${API}/items/${encodeURIComponent(brandName)}`);
      setItemsHistory(response.data);
      setSelectedBrand(brandName);
      setViewMode('items-history');
    } catch (error) {
      console.error('Error loading items history:', error);
      toast.error('Error loading items history');
    }
  };

  const viewAllHistory = async () => {
    try {
      const response = await axios.get(`${API}/all-history`);
      setAllHistory(response.data);
      setViewMode('all-history');
    } catch (error) {
      console.error('Error loading all history:', error);
      toast.error('Error loading all history');
    }
  };

  const exportResults = () => {
    if (!dashboardData) return;

    const exportData = [];
    exportData.push(['Brand', 'Type', 'Price Up', 'Price Down', 'New Items', 'Removed', 'No Change', 'Total', 'Change %']);

    BRAND_GROUPS.forEach((group) => {
      const ownBrand = dashboardData.brands.find(b => b.brand_name === group.own);
      if (ownBrand) {
        const data = ownBrand.latest_data.vs_baseline || {};
        exportData.push([
          group.own,
          'OWN',
          data.price_up || 0,
          data.price_down || 0,
          data.new_items || 0,
          data.removed || 0,
          data.no_change || 0,
          data.total || 0,
          data.change_percent ? data.change_percent.toFixed(1) + '%' : '0%',
        ]);
      }

      group.competitors.forEach((comp) => {
        const compBrand = dashboardData.brands.find(b => b.brand_name === comp);
        if (compBrand) {
          const data = compBrand.latest_data.vs_baseline || {};
          exportData.push([
            comp,
            'COMP',
            data.price_up || 0,
            data.price_down || 0,
            data.new_items || 0,
            data.removed || 0,
            data.no_change || 0,
            data.total || 0,
            data.change_percent ? data.change_percent.toFixed(1) + '%' : '0%',
          ]);
        }
      });
    });

    const ws = XLSX.utils.aoa_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Comparison Results');
    XLSX.writeFile(wb, `Menu_Price_Tracker_${dashboardData.latest_date.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`);
    toast.success('✓ Results exported successfully');
  };

  const calculateOwnBrandsTotals = (type = 'vs_baseline') => {
    if (!dashboardData) return { price_up: 0, price_down: 0, new_items: 0, removed: 0, no_change: 0, total: 0 };

    const ownBrands = BRAND_GROUPS.map(g => g.own);
    const totals = { price_up: 0, price_down: 0, new_items: 0, removed: 0, no_change: 0, total: 0 };

    dashboardData.brands.forEach(brand => {
      if (ownBrands.includes(brand.brand_name)) {
        const data = brand.latest_data[type] || {};
        totals.price_up += data.price_up || 0;
        totals.price_down += data.price_down || 0;
        totals.new_items += data.new_items || 0;
        totals.removed += data.removed || 0;
        totals.no_change += data.no_change || 0;
        totals.total += data.total || 0;
      }
    });

    return totals;
  };

  if (viewMode === 'all-history' && allHistory) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white mb-1" data-testid="all-history-title">📅 All History Timeline</h1>
                <p className="text-gray-400 text-sm">Day-by-day summary across all own brands · Baseline: {baselineDate}</p>
              </div>
              <Button
                onClick={() => setViewMode('dashboard')}
                variant="outline"
                className="bg-[#0b0b0f] border-[#1a1a1f] text-white hover:bg-white/10"
                data-testid="back-to-dashboard-button"
              >
                <X className="w-4 h-4 mr-2" />
                Back
              </Button>
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid md:grid-cols-4 gap-4 mb-6">
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Total Dates</div>
              <div className="text-white text-2xl font-bold">{allHistory.dates_summary.length}</div>
            </div>
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Latest Upload</div>
              <div className="text-green-400 text-2xl font-bold">{allHistory.latest_date}</div>
            </div>
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Brands Tracked</div>
              <div className="text-blue-400 text-2xl font-bold">{allHistory.total_brands}</div>
            </div>
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Own Brands</div>
              <div className="text-green-400 text-2xl font-bold">{allHistory.own_brands_count}</div>
            </div>
          </div>

          {/* Date-by-Date Table */}
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                    <th className="text-left p-4 text-gray-400 font-semibold text-sm">DATE</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">BRANDS</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">▲ PRICE UP</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">▼ PRICE DOWN</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">🟢 NEW ITEMS</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">🔴 REMOVED</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">✅ NO CHANGE</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">TOTAL ITEMS</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">CHG%</th>
                  </tr>
                </thead>
                <tbody>
                  {allHistory.dates_summary.map((dateData, idx) => {
                    const changePercent = dateData.total_items > 0 
                      ? ((dateData.total_price_up + dateData.total_price_down) / dateData.total_items) * 100 
                      : 0;

                    return (
                      <tr 
                        key={idx} 
                        className="border-b border-[#1a1a1f] hover:bg-white/5"
                        data-testid={`history-date-row-${idx}`}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-semibold">{dateData.date}</span>
                            {idx === 0 && (
                              <span className="inline-block px-2 py-1 rounded-full bg-green-400/20 text-green-400 text-xs font-semibold">
                                Latest
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="text-center p-4 text-gray-300">{dateData.brands_count}</td>
                        <td className="text-center p-4">
                          {dateData.total_price_up > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-green-400/20 text-green-400 text-sm font-semibold">
                              {dateData.total_price_up}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4">
                          {dateData.total_price_down > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-red-400/20 text-red-400 text-sm font-semibold">
                              {dateData.total_price_down}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4">
                          {dateData.total_new_items > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-semibold">
                              {dateData.total_new_items}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4">
                          {dateData.total_removed > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-purple-400/20 text-purple-400 text-sm font-semibold">
                              {dateData.total_removed}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4">
                          {dateData.total_no_change > 0 ? (
                            <span className="inline-block px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 text-sm font-semibold">
                              {dateData.total_no_change}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="text-center p-4">
                          <span className="text-blue-400 font-semibold">{dateData.total_items}</span>
                        </td>
                        <td className="text-center p-4">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                              changePercent > 50
                                ? 'bg-red-400/20 text-red-400'
                                : changePercent > 20
                                ? 'bg-yellow-400/20 text-yellow-400'
                                : 'bg-green-400/20 text-green-400'
                            }`}
                          >
                            {changePercent.toFixed(1)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="text-center mt-6 text-gray-500 text-sm">
            All comparisons are vs. Baseline ({baselineDate})
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'brand-history' && brandHistory) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white mb-1" data-testid="brand-history-title">{selectedBrand}</h1>
                <p className="text-gray-400 text-sm">Day-wise Price Change History</p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={() => viewItemsHistory(selectedBrand)}
                  variant="outline"
                  className="bg-[#0b0b0f] border-[#1a1a1f] text-cyan-400 hover:bg-cyan-400/10"
                  data-testid="view-items-button"
                >
                  View Items
                </Button>
                <Button
                  onClick={() => setViewMode('dashboard')}
                  variant="outline"
                  className="bg-[#0b0b0f] border-[#1a1a1f] text-white hover:bg-white/10"
                  data-testid="back-to-dashboard-button"
                >
                  <X className="w-4 h-4 mr-2" />
                  Back
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                    <th className="text-left p-4 text-gray-400 font-semibold text-sm">DATE</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">▲ UP</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">▼ DOWN</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">🟢 NEW</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">🔴 REM</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">✅ NC</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">TOTAL</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">CHG%</th>
                  </tr>
                </thead>
                <tbody>
                  {brandHistory.history.map((item, idx) => (
                    <tr key={idx} className="border-b border-[#1a1a1f] hover:bg-white/5" data-testid={`history-row-${idx}`}>
                      <td className="p-4 text-white font-semibold">{item.date}</td>
                      <td className="text-center p-4">
                        {item.price_up > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-green-400/20 text-green-400 text-sm font-semibold">
                            {item.price_up}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {item.price_down > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-red-400/20 text-red-400 text-sm font-semibold">
                            {item.price_down}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {item.new_items > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-semibold">
                            {item.new_items}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {item.removed > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-purple-400/20 text-purple-400 text-sm font-semibold">
                            {item.removed}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {item.no_change > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 text-sm font-semibold">
                            {item.no_change}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        <span className="text-blue-400 font-semibold">{item.total}</span>
                      </td>
                      <td className="text-center p-4">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${
                            item.change_percent > 50
                              ? 'bg-red-400/20 text-red-400'
                              : item.change_percent > 20
                              ? 'bg-yellow-400/20 text-yellow-400'
                              : 'bg-green-400/20 text-green-400'
                          }`}
                        >
                          {item.change_percent.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === 'items-history' && itemsHistory) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-white mb-1" data-testid="items-history-title">{selectedBrand}</h1>
                <p className="text-gray-400 text-sm">Item-wise Price History · Baseline: {itemsHistory.baseline_date}</p>
              </div>
              <Button
                onClick={() => setViewMode('dashboard')}
                variant="outline"
                className="bg-[#0b0b0f] border-[#1a1a1f] text-white hover:bg-white/10"
                data-testid="back-button"
              >
                <X className="w-4 h-4 mr-2" />
                Back
              </Button>
            </div>
          </div>

          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                    <th className="text-left p-4 text-gray-400 font-semibold text-sm sticky left-0 bg-[#0b0b0f] z-10">ITEM NAME</th>
                    <th className="text-center p-4 text-gray-400 font-semibold text-sm">BASELINE</th>
                    {itemsHistory.items[0]?.history.slice(1).map((h, idx) => (
                      <th key={idx} className="text-center p-4 text-gray-400 font-semibold text-sm whitespace-nowrap">{h.date}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {itemsHistory.items.map((item, idx) => {
                    const hasChanges = item.history.some((h, i) => {
                      if (i === 0) return false;
                      const prevPrice = item.baseline_price;
                      return h.price !== prevPrice && h.price !== null;
                    });

                    return (
                      <tr key={idx} className="border-b border-[#1a1a1f] hover:bg-white/5" data-testid={`item-row-${idx}`}>
                        <td className="p-4 text-white sticky left-0 bg-[#101014] z-10">
                          <div className="flex items-center gap-2">
                            {hasChanges && (
                              <TrendingUp className="w-4 h-4 text-yellow-400" />
                            )}
                            {item.item_name}
                          </div>
                        </td>
                        <td className="text-center p-4 text-gray-300">
                          {item.baseline_price !== null && item.baseline_price !== undefined
                            ? `AED ${item.baseline_price.toFixed(2)}`
                            : '—'}
                        </td>
                        {item.history.slice(1).map((h, hidx) => {
                          const baseline = item.baseline_price;
                          const current = h.price;
                          let colorClass = 'text-gray-300';
                          
                          if (current !== null && baseline !== null) {
                            if (current > baseline) colorClass = 'text-green-400 font-semibold';
                            else if (current < baseline) colorClass = 'text-red-400 font-semibold';
                          }

                          return (
                            <td key={hidx} className={`text-center p-4 ${colorClass}`}>
                              {current !== null && current !== undefined
                                ? `AED ${current.toFixed(2)}`
                                : '—'}
                            </td>
                          );
                        })}
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

  if (!hasBaseline || !dashboardData) {
    return (
      <div className="min-h-screen bg-[#0b0b0f] flex items-center justify-center p-6" data-testid="setup-section">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-5xl font-bold text-green-400" data-testid="app-title">📊 MENU PRICE TRACKER</h1>
            <p className="text-gray-400 text-lg" data-testid="app-subtitle">Talabat UAE · Competitive Pricing Intelligence</p>
          </div>

          {!hasBaseline && (
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 space-y-4">
              <h2 className="text-xl font-semibold text-white">Upload Master File (Baseline)</h2>
              <p className="text-gray-400 text-sm">
                Upload the Master_Price_Tracker_v3.xlsx file to set the baseline (24-Feb-25)
              </p>
              <Input
                type="text"
                placeholder="Baseline date (e.g., 24-Feb-25)"
                value={baselineDate}
                onChange={(e) => setBaselineDate(e.target.value)}
                className="bg-[#0b0b0f] border-[#1a1a1f] text-white placeholder:text-gray-500 mb-3"
                data-testid="baseline-date-input"
              />
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleMasterUpload}
                className="bg-[#0b0b0f] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20"
                data-testid="master-file-input"
              />
            </div>
          )}

          {hasBaseline && (
            <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 space-y-4">
              <h2 className="text-xl font-semibold text-white">Upload Scrape Data</h2>
              <p className="text-gray-400 text-sm">
                Upload your first scrape files to start tracking price changes
              </p>
              <Input
                type="text"
                placeholder="e.g., 10-Mar-25"
                value={scrapeDate}
                onChange={(e) => setScrapeDate(e.target.value)}
                className="bg-[#0b0b0f] border-[#1a1a1f] text-white placeholder:text-gray-500"
                data-testid="scrape-date-input"
              />
              <Input
                type="file"
                accept=".xlsx,.xls"
                multiple
                onChange={handleScrapeUpload}
                className="bg-[#0b0b0f] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20"
                data-testid="scrape-files-input"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  const vsBaselineTotals = calculateOwnBrandsTotals('vs_baseline');
  const vsPreviousTotals = calculateOwnBrandsTotals('vs_previous');
  const changeRate = vsBaselineTotals.total > 0 ? ((vsBaselineTotals.price_up + vsBaselineTotals.price_down + vsBaselineTotals.new_items) / vsBaselineTotals.total) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0b0b0f] p-6" data-testid="dashboard-section">
      {/* Header */}
      <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6 mb-6" data-testid="dashboard-header">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-green-400 mb-1" data-testid="dashboard-title">📊 MENU PRICE TRACKER</h1>
            <p className="text-gray-400 text-sm" data-testid="dashboard-subtitle">
              Talabat UAE · Baseline: {baselineDate} · Latest: {dashboardData.latest_date}
              {dashboardData.previous_date && ` · Previous: ${dashboardData.previous_date}`}
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={viewAllHistory}
              variant="outline"
              className="bg-[#0b0b0f] border-[#1a1a1f] text-purple-400 hover:bg-purple-400/10"
              data-testid="view-all-history-button"
            >
              📅 View All History
            </Button>
            <Button
              onClick={() => setShowUploadModal(true)}
              variant="outline"
              className="bg-[#0b0b0f] border-[#1a1a1f] text-cyan-400 hover:bg-cyan-400/10"
              data-testid="upload-data-button"
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Data
            </Button>
            <Button
              onClick={exportResults}
              variant="outline"
              className="bg-[#0b0b0f] border-[#1a1a1f] text-green-400 hover:bg-green-400/10"
              data-testid="export-button"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Section */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Since Baseline */}
        <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6" data-testid="since-baseline-section">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <span className="text-green-400">📊</span>
            Since Baseline ({baselineDate})
          </h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[#0b0b0f] rounded-lg p-3 border border-green-400/30">
              <div className="text-green-400 text-xl font-bold">{vsBaselineTotals.price_up}</div>
              <div className="text-gray-400 text-xs mt-1">▲ Price Up</div>
            </div>
            <div className="bg-[#0b0b0f] rounded-lg p-3 border border-red-400/30">
              <div className="text-red-400 text-xl font-bold">{vsBaselineTotals.price_down}</div>
              <div className="text-gray-400 text-xs mt-1">▼ Price Down</div>
            </div>
            <div className="bg-[#0b0b0f] rounded-lg p-3 border border-cyan-400/30">
              <div className="text-cyan-400 text-xl font-bold">{vsBaselineTotals.new_items}</div>
              <div className="text-gray-400 text-xs mt-1">🟢 New</div>
            </div>
          </div>
        </div>

        {/* Vs Last Upload */}
        {dashboardData.previous_date && (
          <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg p-6" data-testid="vs-previous-section">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <span className="text-purple-400">🔄</span>
              Vs Last Upload ({dashboardData.previous_date})
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#0b0b0f] rounded-lg p-3 border border-green-400/30">
                <div className="text-green-400 text-xl font-bold">{vsPreviousTotals.price_up}</div>
                <div className="text-gray-400 text-xs mt-1">▲ Price Up</div>
              </div>
              <div className="bg-[#0b0b0f] rounded-lg p-3 border border-red-400/30">
                <div className="text-red-400 text-xl font-bold">{vsPreviousTotals.price_down}</div>
                <div className="text-gray-400 text-xs mt-1">▼ Price Down</div>
              </div>
              <div className="bg-[#0b0b0f] rounded-lg p-3 border border-cyan-400/30">
                <div className="text-cyan-400 text-xl font-bold">{vsPreviousTotals.new_items}</div>
                <div className="text-gray-400 text-xs mt-1">🟢 New</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Brand Table */}
      <div className="bg-[#101014] border border-[#1a1a1f] rounded-lg overflow-hidden" data-testid="brand-table">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#0b0b0f] border-b border-[#1a1a1f]">
                <th className="text-left p-4 text-gray-400 font-semibold text-sm">BRAND</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">TYPE</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">▲ UP</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">▼ DN</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">🟢 NEW</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">🔴 REM</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">✅ NC</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">TOTAL</th>
                <th className="text-center p-4 text-gray-400 font-semibold text-sm">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {BRAND_GROUPS.map((group, groupIdx) => {
                const ownBrand = dashboardData.brands.find(b => b.brand_name === group.own);
                const ownData = ownBrand?.latest_data?.vs_baseline || {};

                return (
                  <>
                    <tr
                      key={`own-${groupIdx}`}
                      className="border-b border-[#1a1a1f] bg-green-400/5 hover:bg-green-400/10"
                      data-testid={`brand-row-own-${groupIdx}`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-green-400">⭐</span>
                          <span className="text-white font-semibold">{group.own}</span>
                        </div>
                      </td>
                      <td className="text-center p-4">
                        <span className="inline-block px-2 py-1 rounded-full bg-green-400/20 text-green-400 text-xs font-semibold">OWN</span>
                      </td>
                      <td className="text-center p-4">
                        {ownData.price_up > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-green-400/20 text-green-400 text-sm font-semibold">{ownData.price_up}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {ownData.price_down > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-red-400/20 text-red-400 text-sm font-semibold">{ownData.price_down}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {ownData.new_items > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-semibold">{ownData.new_items}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {ownData.removed > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-purple-400/20 text-purple-400 text-sm font-semibold">{ownData.removed}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        {ownData.no_change > 0 ? (
                          <span className="inline-block px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 text-sm font-semibold">{ownData.no_change}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="text-center p-4">
                        <span className="text-blue-400 font-semibold">{ownData.total || 0}</span>
                      </td>
                      <td className="text-center p-4">
                        <Button
                          onClick={() => viewBrandHistory(group.own)}
                          variant="ghost"
                          size="sm"
                          className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10"
                          data-testid={`view-history-${groupIdx}`}
                        >
                          View History
                        </Button>
                      </td>
                    </tr>

                    {group.competitors.map((comp, compIdx) => {
                      const compBrand = dashboardData.brands.find(b => b.brand_name === comp);
                      const compData = compBrand?.latest_data?.vs_baseline || {};

                      return (
                        <tr
                          key={`comp-${groupIdx}-${compIdx}`}
                          className="border-b border-[#1a1a1f] hover:bg-white/5"
                          data-testid={`brand-row-comp-${groupIdx}-${compIdx}`}
                        >
                          <td className="p-4 pl-8">
                            <span className="text-gray-300">{comp}</span>
                          </td>
                          <td className="text-center p-4">
                            <span className="inline-block px-2 py-1 rounded-full bg-gray-600/20 text-gray-400 text-xs font-semibold">COMP</span>
                          </td>
                          <td className="text-center p-4">
                            {compData.price_up > 0 ? (
                              <span className="inline-block px-3 py-1 rounded-full bg-green-400/20 text-green-400 text-sm font-semibold">{compData.price_up}</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="text-center p-4">
                            {compData.price_down > 0 ? (
                              <span className="inline-block px-3 py-1 rounded-full bg-red-400/20 text-red-400 text-sm font-semibold">{compData.price_down}</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="text-center p-4">
                            {compData.new_items > 0 ? (
                              <span className="inline-block px-3 py-1 rounded-full bg-cyan-400/20 text-cyan-400 text-sm font-semibold">{compData.new_items}</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="text-center p-4">
                            {compData.removed > 0 ? (
                              <span className="inline-block px-3 py-1 rounded-full bg-purple-400/20 text-purple-400 text-sm font-semibold">{compData.removed}</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="text-center p-4">
                            {compData.no_change > 0 ? (
                              <span className="inline-block px-3 py-1 rounded-full bg-gray-400/20 text-gray-400 text-sm font-semibold">{compData.no_change}</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                          <td className="text-center p-4">
                            <span className="text-blue-400 font-semibold">{compData.total || 0}</span>
                          </td>
                          <td className="text-center p-4">
                            <Button
                              onClick={() => viewBrandHistory(comp)}
                              variant="ghost"
                              size="sm"
                              className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10"
                              data-testid={`view-comp-history-${groupIdx}-${compIdx}`}
                            >
                              View History
                            </Button>
                          </td>
                        </tr>
                      );
                    })}

                    {groupIdx < BRAND_GROUPS.length - 1 && (
                      <tr key={`separator-${groupIdx}`}>
                        <td colSpan="9" className="h-2 bg-[#0b0b0f]"></td>
                      </tr>
                    )}
                  </>
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
              <Button
                onClick={() => setShowUploadModal(false)}
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-white"
                data-testid="close-modal-button"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-6">
              {/* Update Master */}
              <div className="bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg p-4 space-y-3">
                <h3 className="text-white font-semibold">Update Master File (Optional)</h3>
                <p className="text-gray-400 text-sm">Upload a new master file to update the baseline</p>
                <Input
                  type="text"
                  placeholder="Baseline date (e.g., 24-Feb-25)"
                  value={baselineDate}
                  onChange={(e) => setBaselineDate(e.target.value)}
                  className="bg-[#101014] border-[#1a1a1f] text-white placeholder:text-gray-500"
                  data-testid="modal-baseline-date-input"
                />
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleMasterUpload}
                  className="bg-[#101014] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20"
                  data-testid="modal-master-file-input"
                />
              </div>

              {/* Upload Scrape */}
              <div className="bg-[#0b0b0f] border border-[#1a1a1f] rounded-lg p-4 space-y-3">
                <h3 className="text-white font-semibold">Upload Scrape Data</h3>
                <p className="text-gray-400 text-sm">Upload scrape files for a specific date</p>
                <Input
                  type="text"
                  placeholder="e.g., 10-Mar-25"
                  value={scrapeDate}
                  onChange={(e) => setScrapeDate(e.target.value)}
                  className="bg-[#101014] border-[#1a1a1f] text-white placeholder:text-gray-500"
                  data-testid="modal-scrape-date-input"
                />
                <Input
                  type="file"
                  accept=".xlsx,.xls"
                  multiple
                  onChange={handleScrapeUpload}
                  className="bg-[#101014] border-[#1a1a1f] text-white cursor-pointer file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-green-400/10 file:text-green-400 file:font-medium hover:file:bg-green-400/20"
                  data-testid="modal-scrape-files-input"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="text-center mt-6 text-gray-500 text-sm">COMPETITIVE PRICING INTELLIGENCE · TALABAT UAE</div>
    </div>
  );
};

export default Dashboard;
