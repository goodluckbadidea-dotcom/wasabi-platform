// ─── Iframe Sandbox Helpers ───
// JavaScript code strings injected into sandboxed iframes so that plugin/html
// widget functions have access to the same helpers as toolExecutor.js's sandbox.
// Used by PluginWidget.jsx and CustomView.jsx HtmlWidget.

/**
 * Sandbox helper functions as JS code string.
 * Provides: sum, avg, min, max, round, groupBy, sortBy, unique,
 * currency, percent, compact, flatten, pick, omit, chunk, zip,
 * now, parseDate, dateAdd, dateDiff, weeksBetween, monthsBetween,
 * startOfWeek, formatDate, trim, upper, lower
 */
export const IFRAME_SANDBOX_HELPERS = `
function _escapeHtml(s) {
  if (typeof s !== 'string') s = String(s == null ? '' : s);
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function sum(arr) { return (arr||[]).reduce(function(a,b){return a+(Number(b)||0);},0); }
function avg(arr) { return arr&&arr.length ? sum(arr)/arr.length : 0; }
function min(arr) { return Math.min.apply(null,(arr||[]).map(Number).filter(function(n){return !isNaN(n);})); }
function max(arr) { return Math.max.apply(null,(arr||[]).map(Number).filter(function(n){return !isNaN(n);})); }
function round(n,d) { d=d||2; var f=Math.pow(10,d); return Math.round((Number(n)||0)*f)/f; }
function unique(arr,key) { if(!key)return[...new Set(arr||[])]; var s=new Set(); return(arr||[]).filter(function(o){var v=o[key];if(s.has(v))return false;s.add(v);return true;}); }
function groupBy(arr,key) { var r={}; (arr||[]).forEach(function(o){var k=o[key]||'';(r[k]=r[k]||[]).push(o);}); return r; }
function sortBy(arr,key,dir) { return(arr||[]).slice().sort(function(a,b){var va=a[key],vb=b[key];if(va<vb)return dir==='desc'?1:-1;if(va>vb)return dir==='desc'?-1:1;return 0;}); }
function currency(n,c) { try{return new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(n||0);}catch(e){return '$'+(Number(n)||0).toFixed(2);} }
function percent(n,d) { return(Number(n)||0).toFixed(d||1)+'%'; }
function compact(n) { var v=Number(n)||0;if(Math.abs(v)>=1e6)return(v/1e6).toFixed(1)+'M';if(Math.abs(v)>=1e3)return(v/1e3).toFixed(1)+'K';return String(v); }
function flatten(arr) { return(arr||[]).flat(Infinity); }
function pick(obj,keys) { var r={};(keys||[]).forEach(function(k){if(obj&&obj[k]!==undefined)r[k]=obj[k];}); return r; }
function omit(obj,keys) { var s=new Set(keys||[]);var r={};Object.entries(obj||{}).forEach(function(e){if(!s.has(e[0]))r[e[0]]=e[1];}); return r; }
function chunk(arr,sz) { var c=[];for(var i=0;i<(arr||[]).length;i+=(sz||1))c.push(arr.slice(i,i+sz));return c; }
function zip(a,b) { return(a||[]).map(function(v,i){return[v,(b||[])[i]];}); }
function now() { return new Date().toISOString().split('T')[0]; }
function parseDate(s) { try{return new Date(s).toISOString().split('T')[0];}catch(e){return '';} }
function dateAdd(s,days) { var d=new Date(s);d.setDate(d.getDate()+days);return d.toISOString().split('T')[0]; }
function dateDiff(s1,s2) { return Math.round((new Date(s2)-new Date(s1))/(1000*60*60*24)); }
function weeksBetween(s1,s2) { return round(dateDiff(s1,s2)/7,1); }
function monthsBetween(d1,d2) { var a=new Date(d1),b=new Date(d2);return(b.getFullYear()-a.getFullYear())*12+(b.getMonth()-a.getMonth()); }
function startOfWeek(s) { var d=new Date(s);d.setDate(d.getDate()-d.getDay());return d.toISOString().split('T')[0]; }
function formatDate(dateInput,fmt) {
  var d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if(isNaN(d))return '';
  var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var y=d.getFullYear(),mo=d.getMonth(),day=d.getDate(),h=d.getHours(),mi=d.getMinutes(),s=d.getSeconds();
  if(fmt==='HH:mm:ss')return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0')+':'+String(s).padStart(2,'0');
  if(fmt==='HH:mm')return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');
  if(fmt==='yyyy-MM-dd')return y+'-'+String(mo+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  if(fmt==='MM/DD/YYYY')return String(mo+1).padStart(2,'0')+'/'+String(day).padStart(2,'0')+'/'+y;
  if(fmt==='MMM D, YYYY')return months[mo]+' '+day+', '+y;
  return d.toISOString().split('T')[0];
}
function trim(s){return String(s||'').trim();}
function upper(s){return String(s||'').toUpperCase();}
function lower(s){return String(s||'').toLowerCase();}
`;

/**
 * Auto-execute and auto-render logic.
 * If the user's code defined function execute(), calls it and renders the result
 * into #root when the code hasn't already rendered anything.
 */
export const IFRAME_AUTO_EXECUTE = `
if (typeof execute === 'function') {
  try {
    var _result = execute({}, {});
    var _root = document.getElementById('root');
    if (_root && (!_root.innerHTML || _root.innerHTML.trim() === '')) {
      var _data = _result && _result.data ? _result.data : _result;
      if (_data && typeof _data === 'object') {
        var _html = '<div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;align-items:center;padding:16px;">';
        Object.entries(_data).forEach(function(entry) {
          var key = entry[0], val = entry[1];
          var display = typeof val === 'number' ? (val < 1 && val > 0 ? percent(val * 100, 1) : compact(val)) : (typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val));
          var label = key.replace(/([A-Z])/g,' $1').replace(/^./,function(s){return s.toUpperCase();});
          _html += '<div style="text-align:center;min-width:80px;padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.06);">';
          _html += '<div style="font-size:24px;font-weight:700;margin-bottom:4px;color:' + _escapeHtml(window.wasabi.colors.accent) + ';">' + _escapeHtml(display) + '</div>';
          _html += '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;opacity:0.6;">' + _escapeHtml(label) + '</div>';
          _html += '</div>';
        });
        _html += '</div>';
        _root.innerHTML = _html;
      } else if (_data !== undefined && _data !== null) {
        _root.innerHTML = '<div style="text-align:center;padding:20px;font-size:24px;font-weight:700;color:' + _escapeHtml(window.wasabi.colors.accent) + ';">' + _escapeHtml(typeof _data === 'object' && _data !== null ? JSON.stringify(_data, null, 2) : String(_data)) + '</div>';
      }
    }
  } catch(execErr) {
    var _root = document.getElementById('root');
    if (_root) _root.innerHTML = '<div style="color:#E05252;padding:12px;font-size:12px;"><strong>Execute Error:</strong> ' + _escapeHtml(execErr.message) + '</div>';
  }
}
`;
