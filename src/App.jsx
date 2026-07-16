import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'firebase/auth';
import {
  collection, getDocs, doc, addDoc, updateDoc, deleteDoc
} from 'firebase/firestore';
import { auth, db } from './firebase.js';

// ===================== UTILS =====================
const today = () => new Date().toISOString().split('T')[0];
const formatDate = (d) => {
  if (!d) return '—';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
};
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const INACTIVIDAD_LIMITE = 60 * 60 * 1000; // 1 hora
const AVISO_ANTICIPADO = 60 * 1000; // 1 minuto antes

// ===================== TOAST (contexto simple vía callback) =====================
function Toast({ toast }) {
  return (
    <div className={`toast${toast ? ' show' : ''}`} id="toast">
      <span id="toast-icon">{toast?.icon || '✅'}</span>
      <span id="toast-msg">{toast?.msg || ''}</span>
    </div>
  );
}

// ===================== PANTALLA DE LOGIN =====================
function LoginScreen() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !pass.trim()) {
      setError('Completa todos los campos');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass.trim());
    } catch (e) {
      setError(e.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera.' : 'Correo o contraseña incorrectos');
      setLoading(false);
    }
  };

  const onKeyDown = (e) => { if (e.key === 'Enter') handleLogin(); };

  return (
    <div id="login-screen">
      <div className="login-card">
        <div className="login-logo-wrap">
          <div className="login-logo-circle">🚕</div>
          <div className="login-coop-name">Cooperativa de Taxis<br />Ciudad de Portoviejo N°14</div>
          <div className="login-subtitle">Sistema de Gestión Cooperativa</div>
        </div>
        <div className="login-divider"></div>
        {error && <div className="login-error" style={{ display: 'block' }}>{error}</div>}
        <div className="field-group">
          <label className="field-label">📧 Correo electrónico</label>
          <input type="email" className="field-input" placeholder="correo@ejemplo.com" autoComplete="email"
            value={email} onChange={e => setEmail(e.target.value)} onKeyDown={onKeyDown} />
        </div>
        <div className="field-group">
          <label className="field-label">🔐 Contraseña</label>
          <input type="password" className="field-input" placeholder="••••••••" autoComplete="current-password"
            value={pass} onChange={e => setPass(e.target.value)} onKeyDown={onKeyDown} />
        </div>
        <button className="login-btn" onClick={handleLogin} disabled={loading}>
          {loading ? 'Ingresando...' : '🔐 Ingresar al Sistema'}
        </button>
        <div className="login-note">🔒 Acceso restringido · Solo personal autorizado</div>
      </div>
    </div>
  );
}

// ===================== MÓDULO BITÁCORA =====================
function ModuloBitacora({ showToast, setDialogConfig }) {
  const [bitacora, setBitacora] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [fecha, setFecha] = useState(today());
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtroMes, setFiltroMes] = useState('');

  const cargarBitacora = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'bitacora'));
      const lista = [];
      snap.forEach(d => lista.push({ ...d.data(), firebaseId: d.id }));
      lista.sort((a, b) => b.fecha.localeCompare(a.fecha));
      setBitacora(lista);
    } catch (e) {
      console.error(e);
      showToast('No se pudo cargar la bitácora.', '❌');
    } finally {
      setCargando(false);
    }
  }, [showToast]);

  useEffect(() => { cargarBitacora(); }, [cargarBitacora]);

  const guardarEntrada = async () => {
    if (!fecha || !texto.trim()) { showToast('Completa fecha y texto', '⚠️'); return; }
    try {
      const existe = bitacora.find(e => e.fecha === fecha);
      if (existe) {
        await updateDoc(doc(db, 'bitacora', existe.firebaseId), { fecha, texto: texto.trim(), actualizado: today() });
        showToast('Entrada actualizada', '✅');
      } else {
        await addDoc(collection(db, 'bitacora'), { fecha, texto: texto.trim(), creado: today() });
        showToast('Entrada guardada', '📝');
      }
      setTexto('');
      await cargarBitacora();
    } catch (e) {
      showToast('Error: ' + e.message, '❌');
    }
  };

  const editarEntrada = (fid) => {
    const e = bitacora.find(b => b.firebaseId === fid);
    if (!e) return;
    setFecha(e.fecha);
    setTexto(e.texto);
    window.scrollTo(0, 0);
    showToast('Editando entrada del ' + formatDate(e.fecha), '✏️');
  };

  const eliminarEntrada = (fid) => {
    setDialogConfig({
      message: '¿Eliminar esta entrada?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'bitacora', fid));
          await cargarBitacora();
          showToast('Entrada eliminada', '🗑️');
        } catch (e) {
          showToast('Error: ' + e.message, '❌');
        }
      }
    });
  };

  const listaFiltrada = bitacora.filter(e => {
    const coincideTexto = !busqueda || e.texto.toLowerCase().includes(busqueda.toLowerCase()) || e.fecha.includes(busqueda);
    const coincideMes = !filtroMes || e.fecha.startsWith(filtroMes);
    return coincideTexto && coincideMes;
  });

  return (
    <>
      <div className="glass-card" style={{ marginBottom: 14 }}>
        <div className="card-header"><div className="card-title">📓 Bitácora de la Cooperativa</div></div>
        <div className="field-group">
          <label className="field-label">📅 Fecha de la Entrada</label>
          <input type="date" className="field-input" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">✍️ ¿Qué pasó hoy?</label>
          <textarea className="field-input" rows="4" placeholder="Escribe lo que sucedió..." style={{ resize: 'vertical' }}
            value={texto} onChange={e => setTexto(e.target.value)} />
        </div>
        <button className="btn btn-primary btn-full" onClick={guardarEntrada}>📝 Guardar Entrada</button>
      </div>

      <div className="glass-card">
        <div className="card-header"><div className="card-title">📖 Entradas Registradas</div></div>
        <div className="filter-bar" style={{ marginBottom: 12 }}>
          <input type="text" className="search-input" placeholder="🔍 Buscar en bitácora..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          <input type="month" className="field-input" style={{ width: 'auto', padding: '6px 12px', borderRadius: 20 }}
            value={filtroMes} onChange={e => setFiltroMes(e.target.value)} />
        </div>

        {cargando ? (
          <div className="empty-state"><div className="empty-emoji">⏳</div><div className="empty-title">Cargando...</div></div>
        ) : listaFiltrada.length === 0 ? (
          <div className="empty-state"><div className="empty-emoji">📭</div><div className="empty-title">Sin entradas aún</div></div>
        ) : (
          listaFiltrada.map(e => (
            <div className="bitacora-entry" key={e.firebaseId}>
              <div className="bitacora-header">
                <div className="bitacora-fecha">
                  📅 {formatDate(e.fecha)}
                  <span className="bitacora-dia">{DIAS_SEMANA[new Date(e.fecha + 'T12:00:00').getDay()]}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => editarEntrada(e.firebaseId)}>✏️</button>
                  <button className="btn btn-red btn-sm" onClick={() => eliminarEntrada(e.firebaseId)}>🗑️</button>
                </div>
              </div>
              <div className="bitacora-texto">
                {e.texto.split('\n').map((linea, i) => <React.Fragment key={i}>{i > 0 && <br />}{linea}</React.Fragment>)}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ===================== MÓDULO PLACEHOLDER (Admin / Asistencia, pendientes de migrar) =====================
function ModuloPendiente({ nombre }) {
  return (
    <div className="glass-card">
      <div className="empty-state">
        <div className="empty-emoji">🚧</div>
        <div className="empty-title">{nombre} — próximamente</div>
        <div className="empty-sub">Este módulo todavía se está migrando a la nueva tecnología. Por ahora, sigue usándolo desde la versión anterior mientras confirmamos que la Bitácora funciona bien.</div>
      </div>
    </div>
  );
}

// ===================== APP PRINCIPAL =====================
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = cargando, null = sin sesión
  const [modulo, setModulo] = useState('admin');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkmode') === '1');
  const [toast, setToast] = useState(null);
  const [dialogConfig, setDialogConfig] = useState(null);
  const [avisoInactividad, setAvisoInactividad] = useState(false);
  const [countdown, setCountdown] = useState(60);

  const toastTimerRef = useRef(null);
  const inactividadTimerRef = useRef(null);
  const avisoTimerRef = useRef(null);
  const countdownIntervalRef = useRef(null);

  const showToast = useCallback((msg, icon = '✅') => {
    clearTimeout(toastTimerRef.current);
    setToast({ msg, icon });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // --- Dark mode: refleja en <body> igual que la versión original ---
  useEffect(() => {
    document.body.classList.toggle('dark-mode', darkMode);
    localStorage.setItem('darkmode', darkMode ? '1' : '0');
  }, [darkMode]);

  // --- Autenticación ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u || null));
    return () => unsub();
  }, []);

  // --- Control de inactividad (1 hora, aviso 1 minuto antes) ---
  const ocultarAviso = useCallback(() => {
    setAvisoInactividad(false);
    clearInterval(countdownIntervalRef.current);
  }, []);

  const resetInactividad = useCallback(() => {
    if (!user) return;
    clearTimeout(inactividadTimerRef.current);
    clearTimeout(avisoTimerRef.current);
    ocultarAviso();
    avisoTimerRef.current = setTimeout(() => {
      setAvisoInactividad(true);
      setCountdown(60);
      countdownIntervalRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(countdownIntervalRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    }, INACTIVIDAD_LIMITE - AVISO_ANTICIPADO);
    inactividadTimerRef.current = setTimeout(async () => {
      ocultarAviso();
      await signOut(auth);
      showToast('Sesión cerrada por inactividad', '🔒');
    }, INACTIVIDAD_LIMITE);
  }, [user, ocultarAviso, showToast]);

  useEffect(() => {
    if (!user) {
      clearTimeout(inactividadTimerRef.current);
      clearTimeout(avisoTimerRef.current);
      return;
    }
    resetInactividad();
    const eventos = ['click', 'keydown', 'touchstart', 'mousemove', 'scroll'];
    eventos.forEach(ev => document.addEventListener(ev, resetInactividad, { passive: true }));
    return () => eventos.forEach(ev => document.removeEventListener(ev, resetInactividad));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const seguirActivo = () => resetInactividad();

  const handleLogout = () => {
    setDialogConfig({
      message: '¿Cerrar sesión?',
      onConfirm: async () => { await signOut(auth); }
    });
  };

  const dateBadge = new Date().toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  // --- Cargando sesión ---
  if (user === undefined) {
    return <div id="loader" style={{ display: 'flex' }}><div className="loader-spin"></div></div>;
  }

  // --- Sin sesión: pantalla de login ---
  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div id="app-screen" style={{ display: 'flex' }}>

      {avisoInactividad && (
        <div id="aviso-inactividad" style={{ display: 'flex' }}>
          <div className="aviso-card">
            <div className="aviso-icon">⏰</div>
            <div className="aviso-title">¿Sigues ahí?</div>
            <div className="aviso-text">Por seguridad, la sesión se cerrará automáticamente en:</div>
            <div className="aviso-countdown"><span>{countdown}</span>s</div>
            <div className="aviso-text">Si deseas continuar, toca el botón.</div>
            <button className="btn btn-primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }} onClick={seguirActivo}>✅ Seguir trabajando</button>
          </div>
        </div>
      )}

      <header>
        <div className="header-left">
          <span style={{ fontSize: '1.6rem' }}>🚕</span>
          <div>
            <div className="logo">CoopTaxi N°14</div>
            <div className="logo-sub">Portoviejo · Ecuador</div>
          </div>
        </div>
        <div className="header-center">
          <span className="date-badge">{dateBadge}</span>
        </div>
        <div className="header-right">
          <span className="user-chip">{user.email}</span>
          <button className="ctrl-btn" onClick={() => setDarkMode(v => !v)}>🌙</button>
          <button className="ctrl-btn" onClick={handleLogout} style={{ background: 'rgba(220,38,38,0.1)', color: 'var(--red)', borderColor: 'rgba(220,38,38,0.3)' }}>🚪 Salir</button>
        </div>
      </header>

      <div className="modulos-nav">
        <button className={`modulo-btn${modulo === 'admin' ? ' active' : ''}`} onClick={() => setModulo('admin')}>🏠 Cuota Administrativa</button>
        <button className={`modulo-btn${modulo === 'asistencia' ? ' active' : ''}`} onClick={() => setModulo('asistencia')}>🤝 Asistencia Social</button>
        <button className={`modulo-btn${modulo === 'bitacora' ? ' active' : ''}`} onClick={() => setModulo('bitacora')}>📓 Bitácora</button>
      </div>

      <div className="content-area">
        {modulo === 'admin' && <ModuloPendiente nombre="Cuota Administrativa" />}
        {modulo === 'asistencia' && <ModuloPendiente nombre="Asistencia Social" />}
        {modulo === 'bitacora' && <ModuloBitacora showToast={showToast} setDialogConfig={setDialogConfig} />}
      </div>

      {dialogConfig && (
        <div className="modal-overlay open">
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-title">Confirmar</div>
            <p style={{ margin: '12px 0 20px', fontWeight: 700 }}>{dialogConfig.message}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-full" onClick={() => setDialogConfig(null)}>Cancelar</button>
              <button className="btn btn-primary btn-full" onClick={() => { dialogConfig.onConfirm(); setDialogConfig(null); }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      <Toast toast={toast} />
    </div>
  );
}
