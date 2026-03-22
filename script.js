var canvas = document.getElementById('c');
var ctx = canvas.getContext('2d');
var wrap = document.getElementById('canvas-wrap');
var svgLayer = document.getElementById('svg-layer');

var COLS = 48, ROWS = 32;
var W, H, TW, TH;
var mapTiles = [];
var objects = [];
var tool = 'tree';
var playing = false;
var bpm = 90;
var scanX = 0;
var lastBeat = -1;
var toneStarted = false;
var bird = { x: -60, y: 100, vy: 0, flapT: 0 };
var muted = { tree: false, oak: false, willow: false, grain: false, flower: false, rock: false, pebble: false };
var treeSynth = null, oakSynth = null, willowSynth = null, grainSynth = null, flowerSynth = null, rockSynth = null, pebbleSynth = null;

var TNOTES = ['C5', 'E5', 'G5', 'A5', 'B5', 'D5'];
var TNOTES_HILL = ['C4', 'Eb4', 'F4', 'Ab4', 'Bb4', 'D4'];
var ONOTES = ['C2', 'D2', 'E2', 'G2', 'A2', 'B2'];
var ONOTES_HILL = ['C3', 'Eb3', 'F3', 'G3', 'Bb3', 'D3'];
var WNOTES = ['D3', 'F3', 'Ab3', 'Bb3', 'C4', 'Eb4'];
var WNOTES_WATER = ['D2', 'F2', 'Ab2', 'Bb2', 'C3', 'Eb3'];
var GNOTES = ['A1', 'B1', 'C2', 'D2', 'E2', 'F2'];
var GNOTES_WATER = ['A0', 'B0', 'C1', 'D1', 'E1', 'F1'];
var FNOTES = ['C7', 'D7', 'E7', 'F#7', 'G7', 'A7'];
var FNOTES_WATER = ['C6', 'D6', 'Eb6', 'F6', 'G6', 'Bb6'];

function seededRand(seed) {
	var s = seed;
	return function() {
		s = (s * 1664525 + 1013904223) & 0xffffffff;
		return (s >>> 0) / 4294967296;
	};
}

function initAudio() {
	treeSynth = new Tone.Synth({
		oscillator: { type: 'triangle' },
		envelope: { attack: 0.01, decay: 0.3, sustain: 0, release: 0.3 },
		volume: -8
	}).toDestination();

	oakSynth = new Tone.Synth({
		oscillator: { type: 'sine' },
		envelope: { attack: 0.02, decay: 0.6, sustain: 0.1, release: 0.5 },
		volume: -4
	}).toDestination();

	var wReverb = new Tone.Reverb({ decay: 4, wet: 0.7 }).toDestination();
	var wVib = new Tone.Vibrato({ frequency: 3, depth: 0.4 }).connect(wReverb);
	willowSynth = new Tone.Synth({
		oscillator: { type: 'sine' },
		envelope: { attack: 0.3, decay: 0.8, sustain: 0.4, release: 1.5 },
		volume: -6
	}).connect(wVib);

	var gReverb = new Tone.Reverb({ decay: 8, wet: 0.85 }).toDestination();
	var gChorus = new Tone.Chorus({ frequency: 0.4, delayTime: 18, depth: 0.7, wet: 0.6 }).connect(gReverb);
	var gFilter = new Tone.Filter({ frequency: 280, type: 'lowpass', rolloff: -24 }).connect(gChorus);
	grainSynth = new Tone.Synth({
		oscillator: { type: 'sawtooth' },
		envelope: { attack: 0.8, decay: 1.2, sustain: 0.8, release: 3.0 },
		volume: -2
	}).connect(gFilter);

	var fReverb = new Tone.Reverb({ decay: 1.2, wet: 0.5 }).toDestination();
	var fDist = new Tone.Distortion({ distortion: 0.7, wet: 0.4 }).connect(fReverb);
	var fEnv = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 }).connect(fDist);
	var fOsc = new Tone.Oscillator({ type: 'square', volume: -6 }).connect(fEnv);
	flowerSynth = {
		trigger: function(note, time) {
			fOsc.frequency.setValueAtTime(Tone.Frequency(note).toFrequency(), time);
			fOsc.start(time); fEnv.triggerAttackRelease('16n', time); fOsc.stop(time + 0.5);
		}
	};

	rockSynth = new Tone.MembraneSynth({
		pitchDecay: 0.05, octaves: 6,
		envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
		volume: -4
	}).toDestination();

	pebbleSynth = {
		trigger: function(time) {
			var osc = new Tone.Oscillator({ type: 'sine', frequency: 1200, volume: 2 }).toDestination();
			var osc2 = new Tone.Oscillator({ type: 'sine', frequency: 1800, volume: -2 }).toDestination();
			var env = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.07, sustain: 0, release: 0.04 }).toDestination();
			osc.connect(env); osc2.connect(env);
			osc.start(time); osc2.start(time);
			env.triggerAttack(time); env.triggerRelease(time + 0.08);
			osc.stop(time + 0.15); osc2.stop(time + 0.15);
		}
	};
}

function toggleMute(type) {
	muted[type] = !muted[type];
	var btn = document.getElementById('mute-' + type);
	if (muted[type]) btn.classList.add('muted');
	else btn.classList.remove('muted');
}

function safeSet(r, c, val) {
	if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
	if (!mapTiles[r]) mapTiles[r] = [];
	mapTiles[r][c] = val;
}

function generateMap() {
	var rand = seededRand(Date.now() & 0xfffff);
	var r, c, i, cx, cy, rx, ry, dx, dy;
	mapTiles = [];
	for (r = 0; r < ROWS; r++) {
		mapTiles[r] = [];
		for (c = 0; c < COLS; c++) mapTiles[r][c] = 0;
	}
	var nWater = 9 + Math.floor(rand() * 5);
	for (i = 0; i < nWater; i++) {
		cx = 3 + Math.floor(rand() * (COLS - 6));
		cy = 2 + Math.floor(rand() * (ROWS - 4));
		rx = 2 + Math.floor(rand() * 6);
		ry = 1 + Math.floor(rand() * 4);
		for (r = cy - ry - 2; r <= cy + ry + 2; r++) {
			for (c = cx - rx - 2; c <= cx + rx + 2; c++) {
				dx = (c - cx) / rx; dy = (r - cy) / ry;
				if (dx * dx + dy * dy < 1 + rand() * 0.6) safeSet(r, c, 1);
			}
		}
	}
	var nRivers = 2 + Math.floor(rand() * 3);
	for (i = 0; i < nRivers; i++) {
		var rc = Math.floor(rand() * COLS), rr = Math.floor(rand() * ROWS);
		var len = 8 + Math.floor(rand() * 14);
		for (var s = 0; s < len; s++) {
			safeSet(rr, rc, 1); safeSet(rr, rc + 1, 1);
			var dir = rand();
			if (dir < 0.5) rc += 1; else if (dir < 0.75) rr += 1; else rr -= 1;
		}
	}
	var nHills = 7 + Math.floor(rand() * 5);
	for (i = 0; i < nHills; i++) {
		cx = 2 + Math.floor(rand() * (COLS - 4));
		cy = 1 + Math.floor(rand() * (ROWS - 2));
		rx = 2 + Math.floor(rand() * 5);
		ry = 1 + Math.floor(rand() * 4);
		for (r = cy - ry; r <= cy + ry; r++) {
			for (c = cx - rx; c <= cx + rx; c++) {
				if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
				if (mapTiles[r][c] === 1) continue;
				dx = (c - cx) / rx; dy = (r - cy) / ry;
				if (dx * dx + dy * dy < 1 + rand() * 0.3) safeSet(r, c, 2);
			}
		}
	}
}

function resize() {
	W = wrap.clientWidth; H = wrap.clientHeight;
	canvas.width = W; canvas.height = H;
	TW = W / COLS; TH = H / ROWS;
	svgLayer.setAttribute('width', W);
	svgLayer.setAttribute('height', H);
	bird.y = H * 0.25;
	renderSVGObjects(-1);
	draw();
}

function drawMap() {
	var r, c, row, col, t, tx, ty, l, lx, ly, hl, hlx;
	ctx.fillStyle = '#e8e3d5'; ctx.fillRect(0, 0, W, H);
	var rand2 = seededRand(42);
	ctx.fillStyle = '#c8c0aa';
	for (var i = 0; i < 1800; i++) {
		var sx = rand2() * W, sy = rand2() * H;
		var sc = Math.floor(sx / TW), sr = Math.floor(sy / TH);
		if (sc >= 0 && sc < COLS && sr >= 0 && sr < ROWS && mapTiles[sr][sc] === 0) ctx.fillRect(sx, sy, 1, 1);
	}
	for (row = 0; row < ROWS; row++) {
		for (col = 0; col < COLS; col++) {
			t = mapTiles[row][col]; tx = col * TW; ty = row * TH;
			if (t === 1) {
				ctx.fillStyle = '#b8ccd4'; ctx.fillRect(tx, ty, TW, TH);
				var sr2 = seededRand((row * 100 + col) * 7);
				ctx.strokeStyle = '#9ab4be'; ctx.lineWidth = 0.5;
				for (l = 0; l < 2; l++) {
					lx = tx + TW * 0.1 + sr2() * TW * 0.6; ly = ty + TH * 0.3 + l * TH * 0.3;
					ctx.beginPath(); ctx.moveTo(lx, ly); ctx.quadraticCurveTo(lx + TW * 0.15, ly - TH * 0.1, lx + TW * 0.3, ly); ctx.stroke();
				}
			} else if (t === 2) {
				ctx.fillStyle = '#d0c8a8'; ctx.fillRect(tx, ty, TW, TH);
				var sh = seededRand((row * 100 + col) * 13);
				ctx.strokeStyle = '#a89878'; ctx.lineWidth = 0.4;
				for (hl = 0; hl < 3; hl++) {
					hlx = tx + sh() * TW;
					ctx.beginPath(); ctx.moveTo(hlx, ty); ctx.lineTo(hlx + TW * 0.3, ty + TH); ctx.stroke();
				}
			}
		}
	}
	ctx.strokeStyle = 'rgba(100,90,70,0.07)'; ctx.lineWidth = 0.5;
	for (c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TW, 0); ctx.lineTo(c * TW, H); ctx.stroke(); }
	for (r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TH); ctx.lineTo(W, r * TH); ctx.stroke(); }
}

function renderSVGObjects(highlightCol) {
	// clear existing object elements
	var existing = svgLayer.querySelectorAll('.obj-el');
	var i;
	for (i = 0; i < existing.length; i++) existing[i].parentNode.removeChild(existing[i]);

	for (i = 0; i < objects.length; i++) {
		var obj = objects[i];
		var x = obj.col * TW, y = obj.row * TH;
		var lit = playing && obj.col === highlightCol && !muted[obj.type];
		var symId = 'sym-' + obj.type + (lit ? '-lit' : '');
		var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
		use.setAttribute('href', '#' + symId);
		use.setAttribute('x', x);
		use.setAttribute('y', y);
		use.setAttribute('width', TW);
		use.setAttribute('height', TH);
		use.setAttribute('class', 'obj-el');
		svgLayer.appendChild(use);
	}
}

function drawBird(x, y, flapAngle) {
	ctx.save(); ctx.translate(x, y);
	ctx.strokeStyle = '#1a1208'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
	ctx.fillStyle = '#1a1208'; ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
	var wa = flapAngle;
	ctx.beginPath(); ctx.moveTo(-2, 0); ctx.quadraticCurveTo(-8, -6 + wa * 4, -14, -2 + wa * 6); ctx.stroke();
	ctx.beginPath(); ctx.moveTo(2, 0); ctx.quadraticCurveTo(8, -6 + wa * 4, 14, -2 + wa * 6); ctx.stroke();
	ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-7, 2); ctx.stroke();
	ctx.restore();
}

function draw() {
	ctx.clearRect(0, 0, W, H);
	drawMap();
	if (playing) drawBird(bird.x, bird.y, Math.sin(bird.flapT) * 0.8);
}

var lastTime = 0;
function loop(ts) {
	var dt = Math.min((ts - lastTime) / 1000, 0.05);
	lastTime = ts;
	var col = -1;
	if (playing) {
		var period = (60 / bpm) * COLS;
		var t = ((Tone.Transport.seconds % period) + period) % period;
		scanX = (t / period) * W;
		bird.x = scanX; bird.flapT += dt * 6;
		bird.vy += (Math.sin(bird.flapT * 0.4) * 18 - bird.vy) * dt * 2;
		bird.y += bird.vy * dt;
		if (bird.y < H * 0.08) bird.y = H * 0.08;
		if (bird.y > H * 0.85) bird.y = H * 0.85;
		col = Math.floor(scanX / TW);
		if (col !== lastBeat) { lastBeat = col; triggerBeat(col); }
	}
	draw();
	renderSVGObjects(col);
	requestAnimationFrame(loop);
}

function isNearWater(col, row) {
	var r, c;
	for (r = row - 2; r <= row + 2; r++) {
		for (c = col - 2; c <= col + 2; c++) {
			if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
			if (mapTiles[r][c] === 1) return true;
		}
	}
	return false;
}

function isOnHill(col, row) {
	return mapTiles[row] && mapTiles[row][col] === 2;
}

function triggerBeat(col) {
	if (!toneStarted) return;
	var i, obj, now, tOff, oOff, wOff, gOff, fOff, rOff, pOff, note, onHill, nearWater, t;
	now = Tone.now(); tOff = 0; oOff = 0; wOff = 0; gOff = 0; fOff = 0; rOff = 0; pOff = 0;
	for (i = 0; i < objects.length; i++) {
		obj = objects[i]; t = obj.type;
		if (obj.col !== col) continue;
		if (muted[t]) continue;
		onHill = isOnHill(obj.col, obj.row);
		nearWater = isNearWater(obj.col, obj.row);
		if (t === 'tree') {
			note = onHill ? TNOTES_HILL[obj.row % TNOTES_HILL.length] : TNOTES[obj.row % TNOTES.length];
			treeSynth.triggerAttackRelease(note, onHill ? '8n' : '16n', now + tOff); tOff += 0.005;
		} else if (t === 'oak') {
			note = onHill ? ONOTES_HILL[obj.row % ONOTES_HILL.length] : ONOTES[obj.row % ONOTES.length];
			oakSynth.triggerAttackRelease(note, onHill ? '4n' : '8n', now + oOff); oOff += 0.005;
		} else if (t === 'willow') {
			note = nearWater ? WNOTES_WATER[obj.row % WNOTES_WATER.length] : WNOTES[obj.row % WNOTES.length];
			willowSynth.triggerAttackRelease(note, nearWater ? '2n' : '4n', now + wOff); wOff += 0.005;
		} else if (t === 'grain') {
			note = nearWater ? GNOTES_WATER[obj.row % GNOTES_WATER.length] : GNOTES[obj.row % GNOTES.length];
			grainSynth.triggerAttackRelease(note, '2n', now + gOff); gOff += 0.005;
		} else if (t === 'flower') {
			note = nearWater ? FNOTES_WATER[obj.row % FNOTES_WATER.length] : FNOTES[obj.row % FNOTES.length];
			flowerSynth.trigger(note, now + fOff); fOff += 0.005;
		} else if (t === 'rock') {
			rockSynth.triggerAttackRelease('C1', '8n', now + rOff); rOff += 0.005;
		} else if (t === 'pebble') {
			pebbleSynth.trigger(now + pOff); pOff += 0.005;
		}
	}
}

function playPreview(t, row) {
	if (!toneStarted) return;
	var now = Tone.now();
	if (t === 'tree') treeSynth.triggerAttackRelease(TNOTES[row % TNOTES.length], '16n', now);
	else if (t === 'oak') oakSynth.triggerAttackRelease(ONOTES[row % ONOTES.length], '8n', now);
	else if (t === 'willow') willowSynth.triggerAttackRelease(WNOTES[row % WNOTES.length], '4n', now);
	else if (t === 'grain') grainSynth.triggerAttackRelease(GNOTES[row % GNOTES.length], '2n', now);
	else if (t === 'flower') flowerSynth.trigger(FNOTES[row % FNOTES.length], now);
	else if (t === 'rock') rockSynth.triggerAttackRelease('C1', '8n', now);
	else if (t === 'pebble') pebbleSynth.trigger(now);
}

function setTool(t) {
	tool = t;
	var btns = document.querySelectorAll('.tool-btn'), i;
	for (i = 0; i < btns.length; i++) btns[i].classList.remove('active');
	document.getElementById('btn-' + t).classList.add('active');
}

function updateBPM(v) {
	bpm = +v;
	document.getElementById('bpm-val').textContent = v;
	Tone.Transport.bpm.value = bpm;
}

function togglePlay() {
	Tone.start().then(function() {
		if (!toneStarted) { initAudio(); toneStarted = true; }
		playing = !playing;
		var btn = document.getElementById('play-btn');
		if (playing) {
			Tone.Transport.start(); btn.innerHTML = '&#9632; Stop';
			lastBeat = -1; bird.y = H * 0.25; bird.vy = 0;
		} else {
			Tone.Transport.stop(); btn.innerHTML = '&#9654; Play';
			scanX = 0; lastBeat = -1;
			renderSVGObjects(-1);
		}
	});
}

canvas.addEventListener('click', function(e) {
	var rect = canvas.getBoundingClientRect();
	var col = Math.floor((e.clientX - rect.left) / TW);
	var row = Math.floor((e.clientY - rect.top) / TH);
	if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
	var kept = [], i;
	if (tool === 'erase') {
		for (i = 0; i < objects.length; i++) { if (objects[i].col !== col || objects[i].row !== row) kept.push(objects[i]); }
		objects = kept; renderSVGObjects(-1); return;
	}
	if (mapTiles[row][col] === 1) return;
	for (i = 0; i < objects.length; i++) { if (objects[i].col !== col || objects[i].row !== row) kept.push(objects[i]); }
	objects = kept;
	objects.push({ col: col, row: row, type: tool });
	Tone.start().then(function() {
		if (!toneStarted) { initAudio(); toneStarted = true; }
		playPreview(tool, row);
		renderSVGObjects(-1);
	});
});

$(function() { generateMap(); resize(); requestAnimationFrame(loop); });
$(window).on('resize', resize);