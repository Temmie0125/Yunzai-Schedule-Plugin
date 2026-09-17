// 临时测试：验证 ICS 时区名归一化（utils/icsTimezone.js）在严格环境（TZ=UTC）下的效果
// 正确结果应为 UTC 00:00（即北京时间 08:00），错误结果为 UTC 08:00（浮动时间）或报错
import ICalExpander from 'ical-expander';
import { normalizeIcsTimezoneIds } from '../utils/icsTimezone.js';

function mk(tzid, { vtz = false, quoted = false, folded = false, summary = '测试课程' } = {}) {
  const tzRef = quoted ? `"${tzid}"` : tzid;
  let lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//T//CN'
  ];
  if (vtz) {
    lines.push(
      'BEGIN:VTIMEZONE',
      `TZID:${tzid}`,
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0800',
      'TZOFFSETTO:+0800',
      'TZNAME:CST',
      'END:STANDARD',
      'END:VTIMEZONE'
    );
  }
  let dtstart = `DTSTART;TZID=${tzRef}:20260914T080000`;
  let dtend = `DTEND;TZID=${tzRef}:20260914T093500`;
  if (folded) {
    // 模拟 ICS 折行：把参数值折断，前导空格续行
    const cut = 20;
    dtstart = `DTSTART;TZID=${tzRef.slice(0, cut)}\r\n ${tzRef.slice(cut)}:20260914T080000`;
    dtend = `DTEND;TZID=${tzRef.slice(0, cut)}\r\n ${tzRef.slice(cut)}:20260914T093500`;
  }
  lines.push(
    'BEGIN:VEVENT',
    'UID:x@l',
    `SUMMARY:${summary}`,
    dtstart,
    dtend,
    'END:VEVENT',
    'END:VCALENDAR'
  );
  return lines.join('\r\n');
}

function parseTime(ics) {
  const exp = new ICalExpander({ ics: normalizeIcsTimezoneIds(ics), maxIterations: 10 });
  const all = exp.between(new Date(2026, 8, 1), new Date(2026, 8, 30));
  const o = [...(all.events || []), ...(all.occurrences || [])][0];
  return o ? o.startDate.toJSDate().toISOString() : null;
}

let fail = 0;
function check(label, ics, expect) {
  let got;
  try {
    got = parseTime(ics);
  } catch (err) {
    got = `ERROR: ${err.message}`;
  }
  const ok = got === expect;
  if (!ok) fail++;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}: ${got}`);
}

const GOOD = '2026-09-14T00:00:00.000Z'; // 北京 08:00
// 浮动时间（墙钟 08:00 按主机本地时区解释），期望值随主机时区动态计算
const FLOAT = new Date(2026, 8, 14, 8, 0).toISOString();

// —— 应当归一化为东八区 ——
check('China Standard Time（无VTIMEZONE）', mk('China Standard Time'), GOOD);
check('China Standard Time（带VTIMEZONE）', mk('China Standard Time', { vtz: true }), GOOD);
check('China Standard Time（带引号参数）', mk('China Standard Time', { quoted: true }), GOOD);
check('中国标准时间', mk('中国标准时间'), GOOD);
check('中国标准时间（带VTIMEZONE）', mk('中国标准时间', { vtz: true }), GOOD);
check('北京时间', mk('北京时间'), GOOD);
check('UTC+8', mk('UTC+8'), GOOD);
check('GMT+08:00', mk('GMT+08:00'), GOOD);
check('UTC+0800', mk('UTC+0800'), GOOD);
check('Asia/Chongqing', mk('Asia/Chongqing'), GOOD);
check('PRC', mk('PRC'), GOOD);
check('老版Outlook全名（折行）', mk('(UTC+08:00) Beijing, Chongqing, Hong Kong, Urumqi', { folded: true }), GOOD);

// —— 对照组 / 不得误伤 ——
check('Asia/Shanghai（本来就对）', mk('Asia/Shanghai'), GOOD);
check('America/New_York（保持原样，20:00 UTC=16:00 EDT）', mk('America/New_York'), '2026-09-14T12:00:00.000Z');
check('CST（有歧义，保持浮动不误判）', mk('CST'), FLOAT);
check('GMT-8（标准含义西八区，保持浮动）', mk('GMT-8'), FLOAT);
check('SUMMARY含“北京时间”不被误替换', mk('Asia/Shanghai', { summary: '北京时间杯足球赛' }), GOOD);
// 检查 SUMMARY 原文保留（未被字符串盲替换破坏）
const preserved = normalizeIcsTimezoneIds(mk('Asia/Shanghai', { summary: '北京时间杯足球赛' }));
const okPreserve = preserved.includes('SUMMARY:北京时间杯足球赛');
if (!okPreserve) fail++;
console.log(`[${okPreserve ? 'PASS' : 'FAIL'}] SUMMARY 原文保留完整`);

console.log(fail === 0 ? '\n全部通过 ✓' : `\n${fail} 项失败 ✗`);
process.exit(fail === 0 ? 0 : 1);
