const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_PASSWORD = 'nyugat1908';

const state = {
  poets: [
    { id: 0, name: 'Ady Endre',         verse: 'Vér és arany',               age: 31, distance: '2 km'  },
    { id: 1, name: 'Babits Mihály',      verse: 'Levelek Iris koszorújából',  age: 25, distance: '8 km'  },
    { id: 2, name: 'Kosztolányi Dezső',  verse: 'Négy fal között',            age: 23, distance: '3 km'  },
    { id: 3, name: 'Móricz Zsigmond',    verse: 'Sárarany',                   age: 29, distance: '12 km' },
    { id: 4, name: 'Karinthy Frigyes',   verse: 'Így írtok ti',               age: 21, distance: '5 km'  },
  ],
  scores: [],          // initialized below
  currentPoetIndex: -1,
  phase: 'waiting',    // 'waiting' | 'voting' | 'finished'
  voters: new Map(),   // name -> { hasVoted }
  socketToName: new Map(),
};

// Initialize scores array
state.scores = state.poets.map(p => ({ id: p.id, totalScore: 0, voteCount: 0 }));

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.emit('state', buildClientState(socket.id));

  socket.on('register', ({ name }) => {
    const trimmed = name?.trim().slice(0, 50);
    if (!trimmed) return;

    state.socketToName.set(socket.id, trimmed);
    if (!state.voters.has(trimmed)) {
      state.voters.set(trimmed, { hasVoted: false });
    }

    socket.emit('registered', { name: trimmed });
    socket.emit('state', buildClientState(socket.id));
    io.emit('voter-count', state.voters.size);
  });

  socket.on('vote', ({ rating }) => {
    const name = state.socketToName.get(socket.id);
    if (!name) return;

    const voter = state.voters.get(name);
    if (!voter || voter.hasVoted) return;
    if (state.phase !== 'voting') return;
    if (!Number.isInteger(rating) || rating < 0 || rating > 2) return;

    voter.hasVoted = true;

    const score = state.scores[state.currentPoetIndex];
    score.totalScore += rating;
    score.voteCount  += 1;

    socket.emit('vote-accepted', { rating });
    io.emit('scores-update', buildScores());
  });

  // ─── Admin events ───────────────────────────────────────────────────────────

  socket.on('admin-auth', ({ password }) => {
    const ok = password === ADMIN_PASSWORD;
    socket.emit('admin-auth-result', { success: ok, adminState: ok ? buildAdminState() : null });
  });

  socket.on('admin-open-voting', ({ poetIndex, password }) => {
    if (password !== ADMIN_PASSWORD) return;
    if (poetIndex < 0 || poetIndex >= state.poets.length) return;

    state.currentPoetIndex = poetIndex;
    state.phase = 'voting';
    state.voters.forEach(v => { v.hasVoted = false; });

    io.emit('phase-change', { phase: 'voting', currentPoetIndex: poetIndex });
    io.emit('scores-update', buildScores());
  });

  socket.on('admin-close-voting', ({ password }) => {
    if (password !== ADMIN_PASSWORD) return;
    state.phase = 'waiting';
    io.emit('phase-change', { phase: 'waiting', currentPoetIndex: state.currentPoetIndex });
  });

  socket.on('admin-finish', ({ password }) => {
    if (password !== ADMIN_PASSWORD) return;
    state.phase = 'finished';
    state.currentPoetIndex = -1;
    io.emit('phase-change', { phase: 'finished', currentPoetIndex: -1 });
  });

  socket.on('admin-reset', ({ password }) => {
    if (password !== ADMIN_PASSWORD) return;
    state.currentPoetIndex = -1;
    state.phase = 'waiting';
    state.scores.forEach(s => { s.totalScore = 0; s.voteCount = 0; });
    state.voters.forEach(v => { v.hasVoted = false; });
    io.emit('reset');
    socket.emit('admin-state-update', buildAdminState());
  });

  socket.on('request-state', () => {
    socket.emit('state', buildClientState(socket.id));
  });

  socket.on('disconnect', () => {
    state.socketToName.delete(socket.id);
  });
});

function buildClientState(socketId) {
  const name  = state.socketToName.get(socketId);
  const voter = name ? state.voters.get(name) : null;
  const idx   = state.currentPoetIndex;

  return {
    phase:            state.phase,
    currentPoetIndex: idx,
    currentPoet:      idx >= 0 ? { name: state.poets[idx].name, verse: state.poets[idx].verse, age: state.poets[idx].age, distance: state.poets[idx].distance } : null,
    scores:           buildScores(),
    hasVoted:         voter ? voter.hasVoted : false,
    voterName:        name || null,
  };
}

function buildAdminState() {
  return {
    phase:            state.phase,
    currentPoetIndex: state.currentPoetIndex,
    poets:            state.poets,
    scores:           buildScores(),
    voterCount:       state.voters.size,
  };
}

function buildScores() {
  return state.poets.map((p, i) => {
    const s = state.scores[i];
    return {
      id:         p.id,
      name:       p.name,
      verse:      p.verse,
      totalScore: s.totalScore,
      voteCount:  s.voteCount,
      average:    s.voteCount > 0 ? +(s.totalScore / s.voteCount).toFixed(2) : 0,
      isActive:   i === state.currentPoetIndex && state.phase === 'voting',
    };
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✦ NYUGAT SZAVAZÓRENDSZER ✦`);
  console.log(`  Szavazás:  http://localhost:${PORT}`);
  console.log(`  Kijelző:   http://localhost:${PORT}/display.html`);
  console.log(`  Admin:     http://localhost:${PORT}/admin.html\n`);
});
