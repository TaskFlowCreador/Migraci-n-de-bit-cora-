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

const addDaysStr = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};
const daysBetween = (d1, d2) => Math.round((new Date(d2 + 'T12:00:00') - new Date(d1 + 'T12:00:00')) / 86400000);
const getEstadoCuota = (c) => {
  const h = today();
  if (c.pagada) return 'pagada';
  if (h > c.fechaLimite) return 'atrasada';
  if (daysBetween(h, c.fechaLimite) <= 7) return 'pendiente-hoy';
  return 'pendiente';
};
const getEstadoAsist = (reg) => {
  if (!reg.cuotas || !reg.cuotas.length) return 'al-dia';
  if (reg.cuotas.every(c => c.pagada)) return 'pagado';
  const h = today();
  if (reg.cuotas.some(c => !c.pagada && h > c.fechaLimite)) return 'vencido';
  if (reg.cuotas.some(c => !c.pagada && daysBetween(h, c.fechaLimite) <= 7)) return 'proximo';
  return 'al-dia';
};

const INACTIVIDAD_LIMITE = 60 * 60 * 1000; // 1 hora
const AVISO_ANTICIPADO = 60 * 1000; // 1 minuto antes

// ===================== SKELETON LOADER (tarjetas grises parpadeantes mientras cargan datos) =====================
function SkeletonList({ count = 3 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div className="skeleton-card" key={i}>
          <div className="skeleton-line w-40"></div>
          <div className="skeleton-line w-80"></div>
          <div className="skeleton-line w-60"></div>
        </div>
      ))}
    </>
  );
}

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
          <SkeletonList count={3} />
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

// ===================== MÓDULO ASISTENCIA SOCIAL =====================
function ModuloAsistencia({ showToast, setDialogConfig }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState('nuevo');

  // --- formulario "Nuevo" ---
  const [montoAsist, setMontoAsist] = useState(300); // 300 | 200 | 0 (0 = "otro")
  const [montoCustom, setMontoCustom] = useState('');
  const [numSocio, setNumSocio] = useState('');
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  const [fechaRetiro, setFechaRetiro] = useState(today());
  const [obs, setObs] = useState('');

  // --- filtros "Registros" ---
  const [filtroAsist, setFiltroAsist] = useState('todos');
  const [busqueda, setBusqueda] = useState('');

  // --- modal de cuotas ---
  const [cuotasModal, setCuotasModal] = useState(null); // firebaseId del registro abierto
  const [cuotasEdit, setCuotasEdit] = useState([]); // copia editable de cuotas [{...c, checked, fechaPago}]

  const cargarAsistencia = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'registros'));
      const lista = [];
      snap.forEach(d => lista.push({ ...d.data(), firebaseId: d.id }));
      lista.sort((a, b) => a.numSocio - b.numSocio);
      setRegistros(lista);
    } catch (e) {
      console.error(e);
      showToast('No se pudieron cargar los registros.', '❌');
    } finally {
      setCargando(false);
    }
  }, [showToast]);

  useEffect(() => { cargarAsistencia(); }, [cargarAsistencia]);

  // --- cálculos derivados del formulario (equivalente a calcAsistFechas, pero reactivo) ---
  const montoReal = montoAsist === 0 ? (parseFloat(montoCustom) || 0) : montoAsist;
  const totalPagar = montoReal === 300 ? 330 : montoReal === 200 ? 220 : montoReal > 0 ? Math.round(montoReal * 1.1 * 100) / 100 : 0;
  const cuotaMonto = montoReal === 300 ? 55 : montoReal === 200 ? Math.round(220 / 6 * 100) / 100 : montoReal > 0 ? Math.round(totalPagar / 6 * 100) / 100 : 0;
  const fechaLimitePrimera = fechaRetiro ? addDaysStr(fechaRetiro, 35) : '';
  const cuotasPreview = (fechaRetiro && montoReal > 0) ? Array.from({ length: 6 }, (_, idx) => {
    const i = idx + 1;
    const fb = addDaysStr(fechaRetiro, i * 30);
    const fl = addDaysStr(fb, 5);
    return { num: i, fechaLimite: fl, monto: cuotaMonto };
  }) : [];

  const guardarAsistencia = async () => {
    if (!numSocio || !nombre.trim() || !cedula.trim() || !fechaRetiro) { showToast('Completa todos los campos', '⚠️'); return; }
    if (montoReal <= 0) { showToast('Ingresa un monto válido', '⚠️'); return; }

    const cuotas = cuotasPreview.map(c => ({ num: c.num, monto: c.monto, fechaBase: addDaysStr(fechaRetiro, c.num * 30), fechaLimite: c.fechaLimite, pagada: false, fechaPago: null }));
    const reg = {
      numSocio: parseInt(numSocio), nombre: nombre.trim(), cedula: cedula.trim(),
      monto: montoReal, totalPagar,
      fechaRetiro, fechaLimite: fechaLimitePrimera,
      obs: obs.trim(), cuotas, fechaCreacion: today()
    };

    try {
      await addDoc(collection(db, 'registros'), reg);
      await cargarAsistencia();
      if (window.confetti) window.confetti({ particleCount: 60, spread: 50, origin: { y: 0.7 } });
      showToast(`Asistencia de ${nombre} guardada`, '✅');
      setNumSocio(''); setNombre(''); setCedula(''); setObs(''); setMontoAsist(300); setMontoCustom('');
      setTab('registros');
    } catch (e) {
      showToast('Error: ' + e.message, '❌');
    }
  };

  const eliminarAsist = (fid) => {
    setDialogConfig({
      message: '¿Eliminar este registro de asistencia?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'registros', fid));
          await cargarAsistencia();
          showToast('Eliminado', '🗑️');
        } catch (e) {
          showToast('Error: ' + e.message, '❌');
        }
      }
    });
  };

  const abrirCuotas = (reg) => {
    setCuotasEdit(reg.cuotas.map(c => ({ ...c, checked: c.pagada, fechaPagoInput: c.fechaPago || today() })));
    setCuotasModal(reg.firebaseId);
  };

  const guardarCuotas = async () => {
    const reg = registros.find(r => r.firebaseId === cuotasModal);
    if (!reg) return;
    const nuevasCuotas = cuotasEdit.map(c => ({
      num: c.num, monto: c.monto, fechaBase: c.fechaBase, fechaLimite: c.fechaLimite,
      pagada: c.checked, fechaPago: c.checked ? (c.fechaPagoInput || today()) : null
    }));
    try {
      await updateDoc(doc(db, 'registros', cuotasModal), { cuotas: nuevasCuotas });
      if (nuevasCuotas.every(c => c.pagada) && window.confetti) window.confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
      await cargarAsistencia();
      setCuotasModal(null);
      showToast('Cuotas actualizadas', '💳');
    } catch (e) {
      showToast('Error: ' + e.message, '❌');
    }
  };

  const exportarExcel = () => {
    if (!window.XLSX) { showToast('El exportador todavía está cargando, intenta de nuevo.', '⚠️'); return; }
    const data = [...registros].sort((a, b) => a.numSocio - b.numSocio).map(r => ({
      '#': r.numSocio, 'Nombre': r.nombre, 'Cédula': r.cedula, 'Monto': r.monto, 'Total': r.totalPagar,
      'Retiro': formatDate(r.fechaRetiro), '1ª Cuota Máx': formatDate(r.fechaLimite),
      'Cuotas Pagadas': r.cuotas.filter(c => c.pagada).length, 'Estado': getEstadoAsist(r)
    }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data), 'Asistencia Social');
    window.XLSX.writeFile(wb, `AsistSocial_${today().replace(/-/g, '')}.xlsx`);
    showToast('Excel exportado', '📊');
  };

  let listaFiltrada = [...registros].sort((a, b) => a.numSocio - b.numSocio);
  if (filtroAsist !== 'todos') listaFiltrada = listaFiltrada.filter(r => getEstadoAsist(r) === filtroAsist);
  if (busqueda.trim()) {
    const q = busqueda.toLowerCase();
    listaFiltrada = listaFiltrada.filter(r => r.nombre.toLowerCase().includes(q) || String(r.numSocio).includes(q) || r.cedula.includes(q));
  }

  const chipMap = { 'al-dia': 'chip-verde', 'proximo': 'chip-naranja', 'vencido': 'chip-rojo', 'pagado': 'chip-dorado' };
  const labelMap = { 'al-dia': '✅ Al día', 'proximo': '⚠️ Por vencer', 'vencido': '🔴 Vencido', 'pagado': '💚 Completado' };

  const total = registros.length;
  const aldia = registros.filter(r => getEstadoAsist(r) === 'al-dia').length;
  const vencido = registros.filter(r => getEstadoAsist(r) === 'vencido').length;
  const pagado = registros.filter(r => getEstadoAsist(r) === 'pagado').length;
  const recaudado = registros.reduce((s, r) => s + r.cuotas.filter(c => c.pagada).reduce((s2, c) => s2 + c.monto, 0), 0);

  const cuotasModalReg = cuotasModal ? registros.find(r => r.firebaseId === cuotasModal) : null;
  const totalPagCuotasModal = cuotasEdit.filter(c => c.checked).reduce((s, c) => s + c.monto, 0);

  return (
    <>
      <div className="tabs-nav-inner">
        <button className={`tab-btn${tab === 'nuevo' ? ' active' : ''}`} onClick={() => setTab('nuevo')}>✏️ Nuevo</button>
        <button className={`tab-btn${tab === 'registros' ? ' active' : ''}`} onClick={() => setTab('registros')}>📋 Registros <span className="tab-badge">{registros.length}</span></button>
        <button className={`tab-btn${tab === 'dashboard' ? ' active' : ''}`} onClick={() => setTab('dashboard')}>📊 Resumen</button>
      </div>

      {tab === 'nuevo' && (
        <>
          <div className="glass-card">
            <div className="card-header"><div className="card-title">✏️ Nueva Asistencia Social</div></div>
            <div className="field-group">
              <label className="field-label">💰 Monto del Préstamo</label>
              <div className="monto-options">
                <div className={`monto-opt${montoAsist === 300 ? ' selected' : ''}`} onClick={() => setMontoAsist(300)}>
                  <div className="monto-value">$300</div><div className="monto-label">Máximo</div><div className="monto-total">Total: $330</div>
                </div>
                <div className={`monto-opt${montoAsist === 200 ? ' selected' : ''}`} onClick={() => setMontoAsist(200)}>
                  <div className="monto-value">$200</div><div className="monto-label">Menor</div><div className="monto-total">Total: $220</div>
                </div>
                <div className={`monto-opt${montoAsist === 0 ? ' selected' : ''}`} onClick={() => setMontoAsist(0)}>
                  <div className="monto-value" style={{ fontSize: '1.1rem' }}>Otro</div><div className="monto-label">Personalizado</div><div className="monto-total">Ingresar valor</div>
                </div>
              </div>
              {montoAsist === 0 && (
                <div style={{ marginTop: 10 }}>
                  <label className="field-label">💰 Ingresa el monto del préstamo ($)</label>
                  <input type="number" className="field-input" placeholder="Ej: 150" min="1" step="1"
                    value={montoCustom} onChange={e => setMontoCustom(e.target.value)} />
                  {montoReal > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 700, marginTop: 4 }}>Total a pagar: ${totalPagar.toFixed(2)} (10% de interés)</div>}
                </div>
              )}
            </div>
            <div className="grid-3">
              <div className="field-group"><label className="field-label">🔢 N° Socio</label><input type="number" className="field-input" placeholder="1-61" min="1" max="61" value={numSocio} onChange={e => setNumSocio(e.target.value)} /></div>
              <div className="field-group" style={{ gridColumn: 'span 2' }}><label className="field-label">👤 Nombre</label><input type="text" className="field-input" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} /></div>
            </div>
            <div className="field-group"><label className="field-label">🪪 Cédula</label><input type="text" className="field-input" placeholder="1234567890" maxLength="10" value={cedula} onChange={e => setCedula(e.target.value)} /></div>
            <div className="grid-2">
              <div className="field-group"><label className="field-label">📅 Fecha Retiro</label><input type="date" className="field-input" value={fechaRetiro} onChange={e => setFechaRetiro(e.target.value)} /></div>
              <div className="field-group"><label className="field-label">⏰ 1ª Cuota Máx.</label><input type="date" className="field-input" readOnly style={{ opacity: 0.7 }} value={fechaLimitePrimera} /></div>
            </div>
            {fechaRetiro && (
              <div className="info-box info-box-blue"><span>📌</span><div>Retiro: <strong>{formatDate(fechaRetiro)}</strong> → 1ª cuota máx: <strong>{formatDate(fechaLimitePrimera)}</strong></div></div>
            )}
            {cuotasPreview.length > 0 && (
              <div className="info-box info-box-green"><span>📋</span><div>
                <strong>Fechas límite de las 6 cuotas:</strong><br />
                {cuotasPreview.map(c => <React.Fragment key={c.num}>C{c.num}: <strong>{formatDate(c.fechaLimite)}</strong> · ${c.monto.toFixed(2)} &nbsp;</React.Fragment>)}
              </div></div>
            )}
            <div className="field-group" style={{ marginTop: 10 }}><label className="field-label">📝 Observaciones</label><input type="text" className="field-input" placeholder="Notas..." value={obs} onChange={e => setObs(e.target.value)} /></div>
            <button className="btn btn-primary btn-full" style={{ marginTop: 10 }} onClick={guardarAsistencia}>💾 Guardar</button>
          </div>
          <div className="info-box info-box-blue"><span>📌</span><div>30 días + 5 de gracia = 35 días máx. tras el retiro · 6 cuotas mensuales</div></div>
        </>
      )}

      {tab === 'registros' && (
        <div className="glass-card">
          <div className="card-header"><div className="card-title">📋 Asistencias Activas</div><button className="btn btn-green btn-sm" onClick={exportarExcel}>📊 Excel</button></div>
          <div className="filter-bar">
            <input type="text" className="search-input" placeholder="🔍 Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            {['todos', 'al-dia', 'proximo', 'vencido', 'pagado'].map(f => (
              <button key={f} className={`filter-chip${filtroAsist === f ? ' active' : ''}`} onClick={() => setFiltroAsist(f)}>
                {f === 'todos' ? 'Todos' : f === 'al-dia' ? '✅ Al día' : f === 'proximo' ? '⚠️ Próximos' : f === 'vencido' ? '🔴 Vencidos' : '💚 Completados'}
              </button>
            ))}
          </div>

          {cargando ? <SkeletonList count={3} /> : listaFiltrada.length === 0 ? (
            <div className="empty-state"><div className="empty-emoji">📭</div><div className="empty-title">Sin registros</div></div>
          ) : listaFiltrada.map(r => {
            const estado = getEstadoAsist(r);
            const pagadas = r.cuotas.filter(c => c.pagada).length;
            const totalPag = r.cuotas.filter(c => c.pagada).reduce((s, c) => s + c.monto, 0);
            const pct = Math.round(totalPag / r.totalPagar * 100);
            return (
              <div className={`reg-card ${estado}`} style={{ marginBottom: 12 }} key={r.firebaseId}>
                <div className="reg-top">
                  <div>
                    <div className="reg-socio-num">#{String(r.numSocio).padStart(2, '0')}</div>
                    <div className="reg-socio-name">{r.nombre}</div>
                    <div className="reg-cedula">CI: {r.cedula}</div>
                  </div>
                  <div className="reg-right">
                    <div className="reg-monto">${r.totalPagar}</div>
                    <div className="reg-cuota">{pagadas}/6 · ${r.cuotas[0]?.monto.toFixed(2)}/mes</div>
                    <div className="reg-pagado-label">Pagado: <strong>${totalPag.toFixed(0)}</strong></div>
                  </div>
                </div>
                <div className="progress-wrap"><div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%` }}></div></div><div className="progress-label">{pct}% · ${totalPag.toFixed(0)} de ${r.totalPagar}</div></div>
                <div className="cuotas-track">
                  {r.cuotas.map(c => <div key={c.num} className={`cuota-dot ${getEstadoCuota(c)}`} title={`C${c.num}: ${formatDate(c.fechaLimite)}${c.pagada ? ' ✓' : ''}`}></div>)}
                </div>
                <div className="cuotas-fechas-strip">
                  {r.cuotas.map(c => {
                    const est = getEstadoCuota(c);
                    const col = est === 'pagada' ? 'var(--green)' : est === 'atrasada' ? 'var(--red)' : est === 'pendiente-hoy' ? 'var(--orange)' : 'var(--empty-text)';
                    return (
                      <div className="cuota-fecha-mini" style={{ borderColor: col }} key={c.num}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 900, color: col }}>C{c.num}</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: col }}>{formatDate(c.fechaLimite)}</div>
                        <div style={{ fontSize: '0.6rem', color: col }}>${c.monto.toFixed(2)}</div>
                      </div>
                    );
                  })}
                </div>
                {pagadas > 0 && (
                  <div className="pagos-registrados">
                    <div className="pagos-title">💳 Pagos registrados:</div>
                    {r.cuotas.filter(c => c.pagada).map(c => (
                      <div className="cuota-pago-item" key={c.num}>
                        <span className="cuota-num-mini">{c.num}</span><span>Cuota {c.num}</span>
                        <span className="cuota-fecha-pago">📅 {formatDate(c.fechaPago)}</span>
                        <span className="cuota-monto-mini">${c.monto.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="reg-dates">
                  <div className="reg-date-item"><div className="reg-date-label">📅 Retiro</div><div className="reg-date-value">{formatDate(r.fechaRetiro)}</div></div>
                  <div className="reg-date-item"><div className="reg-date-label">⏰ 1ª Cuota Máx.</div><div className="reg-date-value">{formatDate(r.fechaLimite)}</div></div>
                </div>
                <div className="reg-status-bar">
                  <span className={`status-chip ${chipMap[estado]}`}>{labelMap[estado]}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => abrirCuotas(r)}>💳 Cuotas</button>
                    <button className="btn btn-red btn-sm" onClick={() => eliminarAsist(r.firebaseId)}>🗑️</button>
                  </div>
                </div>
                {r.obs && <div className="reg-obs">📝 {r.obs}</div>}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'dashboard' && (
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-val">{total}</div><div className="stat-lbl">📋 Total</div></div>
          <div className="stat-card"><div className="stat-val green-val">{aldia}</div><div className="stat-lbl">✅ Al Día</div></div>
          <div className="stat-card"><div className="stat-val red-val">{vencido}</div><div className="stat-lbl">🔴 Vencidos</div></div>
          <div className="stat-card"><div className="stat-val green-val">{pagado}</div><div className="stat-lbl">💚 Completos</div></div>
          <div className="stat-card"><div className="stat-val">${recaudado.toFixed(0)}</div><div className="stat-lbl">💰 Recaudado</div></div>
        </div>
      )}

      {cuotasModalReg && (
        <div className="modal-overlay open">
          <div className="modal">
            <div className="modal-title">💳 {cuotasModalReg.nombre}</div>
            <div className="info-box info-box-green" style={{ marginBottom: 12 }}><span>💰</span><div>Pagado: <strong>${totalPagCuotasModal.toFixed(2)}</strong> de <strong>${cuotasModalReg.totalPagar}</strong></div></div>
            <div className="cuotas-list">
              {cuotasEdit.map((c, i) => {
                const est = c.checked ? 'pagada' : getEstadoCuota(c);
                const cl = { pagada: 'chip-verde', atrasada: 'chip-rojo', 'pendiente-hoy': 'chip-naranja', pendiente: 'chip-gris' }[est];
                const lb = { pagada: '✅ Pagada', atrasada: '🔴 Atrasada', 'pendiente-hoy': '⚠️ Por vencer', pendiente: '⏳ Pendiente' }[est];
                return (
                  <div className={`cuota-item${c.checked ? ' cuota-pagada' : ''}`} key={c.num}>
                    <div className="cuota-num">{c.num}</div>
                    <div className="cuota-info">
                      <div className="cuota-fecha">Límite: {formatDate(c.fechaLimite)} · ${c.monto.toFixed(2)}</div>
                      <span className={`status-chip ${cl}`} style={{ fontSize: '0.65rem', marginTop: 3 }}>{lb}</span>
                      {c.checked ? (
                        <div className="cuota-fecha-real">📅 Pagada el: <strong>{formatDate(c.fechaPagoInput)}</strong></div>
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          <label className="field-label">Fecha de pago</label>
                          <input type="date" className="field-input" style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                            value={c.fechaPagoInput} onChange={e => setCuotasEdit(prev => prev.map((x, xi) => xi === i ? { ...x, fechaPagoInput: e.target.value } : x))} />
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <div className="cuota-monto">${c.monto.toFixed(2)}</div>
                      <input type="checkbox" style={{ width: 22, height: 22, cursor: 'pointer', accentColor: 'var(--accent-color)' }}
                        checked={c.checked} onChange={e => setCuotasEdit(prev => prev.map((x, xi) => xi === i ? { ...x, checked: e.target.checked } : x))} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-ghost btn-full" onClick={() => setCuotasModal(null)}>Cancelar</button>
              <button className="btn btn-primary btn-full" onClick={guardarCuotas}>💾 Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ===================== MÓDULO PLACEHOLDER (Admin, pendiente de migrar) =====================
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
        {modulo === 'asistencia' && <ModuloAsistencia showToast={showToast} setDialogConfig={setDialogConfig} />}
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
