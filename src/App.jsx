import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from 'firebase/auth';
import {
  collection, getDocs, doc, addDoc, updateDoc, deleteDoc, setDoc
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

// ===================== UTILS MÓDULO ADMIN (cuotas / multas) =====================
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const CUENTAS = [
  { num: '201242302', desc: 'Cuota Administrativa' },
  { num: '201251105', desc: 'Asistencia Social' },
  { num: '301405288', desc: 'Mortuoria' },
  { num: '11010080770', desc: 'Multas' }
];
const diasEnMes = (anio, mes) => new Date(anio, mes, 0).getDate();
const ultimoDiaMes = (anio, mes) => `${anio}-${String(mes).padStart(2, '0')}-${String(diasEnMes(anio, mes)).padStart(2, '0')}`;
const calcularMulta = (anio, mes, fechaPago) => {
  const limite = new Date(ultimoDiaMes(anio, mes) + 'T23:59:59');
  const pago = new Date(fechaPago + 'T12:00:00');
  if (pago <= limite) return 0;
  const inicio = new Date(anio, mes, 1);
  const diasAtraso = Math.floor((pago - inicio) / 86400000);
  if (diasAtraso <= 0) return 0;
  const tope = diasEnMes(anio, mes) === 28 ? 2.80 : diasEnMes(anio, mes) === 29 ? 2.90 : 3.00;
  return Math.min(Math.round(diasAtraso * 0.10 * 100) / 100, tope);
};
const calcularMultaHoy = (anio, mes) => calcularMulta(anio, mes, today()).toFixed(2);
const getMesActual = () => {
  const n = new Date();
  return { anio: n.getFullYear(), mes: n.getMonth() + 1 };
};
const estaAlDia = (socio) => {
  const { anio, mes } = getMesActual();
  const mesReq = mes === 1 ? 12 : mes - 1;
  const anioReq = mes === 1 ? anio - 1 : anio;
  const key = `${anioReq}-${String(mesReq).padStart(2, '0')}`;
  const pago = socio.pagos && socio.pagos[key];
  if (!pago || !pago.pagado) return false;
  if (pago.multa > 0 && !pago.multaPagada) return false;
  return true;
};

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
// ===================== MÓDULO ASISTENCIA SOCIAL =====================
const OPCIONES_MONTO = [
  { value: 600, label: 'Máximo', total: 660, cuota: 55, cuotas: 12 },
  { value: 300, label: 'Menor', total: 330, cuota: 55, cuotas: 6 },
];

// Tarjeta de registro memoizada: evita que toda la lista se vuelva a dibujar
// cada vez que se abre el modal de cuotas (esa era la causa de la lentitud).
const RegCard = React.memo(function RegCard({ r, onAbrirCuotas, onEliminar }) {
  const estado = getEstadoAsist(r);
  const pagadas = r.cuotas.filter(c => c.pagada).length;
  const totalPag = r.cuotas.filter(c => c.pagada).reduce((s, c) => s + c.monto, 0);
  const pct = Math.round(totalPag / r.totalPagar * 100);
  const chipMap = { 'al-dia': 'chip-verde', 'proximo': 'chip-naranja', 'vencido': 'chip-rojo', 'pagado': 'chip-dorado' };
  const labelMap = { 'al-dia': '✅ Al día', 'proximo': '⚠️ Por vencer', 'vencido': '🔴 Vencido', 'pagado': '💚 Completado' };

  return (
    <div className={`reg-card ${estado}`} style={{ marginBottom: 12 }}>
      <div className="reg-top">
        <div>
          <div className="reg-socio-num">#{String(r.numSocio).padStart(2, '0')}</div>
          <div className="reg-socio-name">{r.nombre}</div>
          <div className="reg-cedula">CI: {r.cedula}</div>
          {r.garanteNumSocio ? <div className="reg-cedula">🤝 Garante: #{String(r.garanteNumSocio).padStart(2, '0')} {r.garanteNombre || ''}</div> : null}
        </div>
        <div className="reg-right">
          <div className="reg-monto">${r.totalPagar}</div>
          <div className="reg-cuota">{pagadas}/{r.cuotas.length} · ${r.cuotas[0]?.monto.toFixed(2)}/mes</div>
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
          <button className="btn btn-primary btn-sm" onClick={() => onAbrirCuotas(r)}>💳 Cuotas</button>
          <button className="btn btn-red btn-sm" onClick={() => onEliminar(r.firebaseId)}>🗑️</button>
        </div>
      </div>
      {r.obs && <div className="reg-obs">📝 {r.obs}</div>}
    </div>
  );
});

function ModuloAsistencia({ showToast, setDialogConfig, socios }) {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState('nuevo');

  // --- formulario "Nuevo" ---
  const [montoAsist, setMontoAsist] = useState(600); // 600 | 300 | 0 (0 = "otro")
  const [montoCustom, setMontoCustom] = useState('');
  const [numSocio, setNumSocio] = useState('');
  const [nombre, setNombre] = useState('');
  const [cedula, setCedula] = useState('');
  const [fechaRetiro, setFechaRetiro] = useState(today());
  const [obs, setObs] = useState('');

  // --- socio garante ---
  const [garanteNum, setGaranteNum] = useState('');
  const [garanteNombre, setGaranteNombre] = useState('');
  const [garanteError, setGaranteError] = useState('');

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

  // --- Autocompletar datos del solicitante al escribir el N° de socio ---
  useEffect(() => {
    const n = parseInt(numSocio);
    if (!n) { return; }
    const s = socios.find(s => s.num === n);
    if (s) { setNombre(s.nombre); setCedula(s.cedula); }
  }, [numSocio, socios]);

  // --- Autocompletar y validar al socio garante ---
  useEffect(() => {
    const g = parseInt(garanteNum);
    if (!g) { setGaranteNombre(''); setGaranteError(''); return; }
    const s = socios.find(s => s.num === g);
    setGaranteNombre(s ? s.nombre : '');
    if (g === parseInt(numSocio)) {
      setGaranteError('El garante no puede ser el mismo socio solicitante.');
      return;
    }
    const yaEsGarante = registros.find(r => r.garanteNumSocio === g && getEstadoAsist(r) !== 'pagado');
    if (yaEsGarante) {
      setGaranteError(`No puede ser seleccionado: ya es garante de ${yaEsGarante.nombre} (#${String(yaEsGarante.numSocio).padStart(2, '0')}).`);
    } else {
      setGaranteError('');
    }
  }, [garanteNum, socios, registros, numSocio]);

  // --- cálculos derivados del formulario (equivalente a calcAsistFechas, pero reactivo) ---
  const opcionSeleccionada = OPCIONES_MONTO.find(o => o.value === montoAsist);
  const montoReal = montoAsist === 0 ? (parseFloat(montoCustom) || 0) : montoAsist;
  const numCuotas = opcionSeleccionada ? opcionSeleccionada.cuotas : 6; // "Otro" siempre a 6 meses
  const totalPagar = opcionSeleccionada ? opcionSeleccionada.total : (montoReal > 0 ? Math.round(montoReal * 1.1 * 100) / 100 : 0);
  const cuotaMonto = opcionSeleccionada ? opcionSeleccionada.cuota : (montoReal > 0 ? Math.round(totalPagar / numCuotas * 100) / 100 : 0);
  const fechaLimitePrimera = fechaRetiro ? addDaysStr(fechaRetiro, 35) : '';
  const cuotasPreview = (fechaRetiro && montoReal > 0) ? Array.from({ length: numCuotas }, (_, idx) => {
    const i = idx + 1;
    const fb = addDaysStr(fechaRetiro, i * 30);
    const fl = addDaysStr(fb, 5);
    return { num: i, fechaLimite: fl, monto: cuotaMonto };
  }) : [];

  const guardarAsistencia = async () => {
    if (!numSocio || !nombre.trim() || !cedula.trim() || !fechaRetiro) { showToast('Completa todos los campos', '⚠️'); return; }
    if (montoReal <= 0) { showToast('Ingresa un monto válido', '⚠️'); return; }
    if (!garanteNum) { showToast('Ingresa el N° de socio garante', '⚠️'); return; }
    if (garanteError) { showToast(garanteError, '⚠️'); return; }

    const cuotas = cuotasPreview.map(c => ({ num: c.num, monto: c.monto, fechaBase: addDaysStr(fechaRetiro, c.num * 30), fechaLimite: c.fechaLimite, pagada: false, fechaPago: null }));
    const reg = {
      numSocio: parseInt(numSocio), nombre: nombre.trim(), cedula: cedula.trim(),
      monto: montoReal, totalPagar,
      garanteNumSocio: parseInt(garanteNum), garanteNombre: garanteNombre || '',
      fechaRetiro, fechaLimite: fechaLimitePrimera,
      obs: obs.trim(), cuotas, fechaCreacion: today()
    };

    try {
      await addDoc(collection(db, 'registros'), reg);
      await cargarAsistencia();
      if (window.confetti) window.confetti({ particleCount: 60, spread: 50, origin: { y: 0.7 } });
      showToast(`Asistencia de ${nombre} guardada`, '✅');
      setNumSocio(''); setNombre(''); setCedula(''); setObs(''); setMontoAsist(600); setMontoCustom('');
      setGaranteNum(''); setGaranteNombre('');
      setTab('registros');
    } catch (e) {
      showToast('Error: ' + e.message, '❌');
    }
  };

  const eliminarAsist = useCallback((fid) => {
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
  }, [setDialogConfig, cargarAsistencia, showToast]);

  const abrirCuotas = useCallback((reg) => {
    setCuotasEdit(reg.cuotas.map(c => ({ ...c, checked: c.pagada, fechaPagoInput: c.fechaPago || today() })));
    setCuotasModal(reg.firebaseId);
  }, []);

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
      'Garante': r.garanteNumSocio ? `#${r.garanteNumSocio} ${r.garanteNombre || ''}` : '—',
      'Retiro': formatDate(r.fechaRetiro), '1ª Cuota Máx': formatDate(r.fechaLimite),
      'Cuotas Pagadas': `${r.cuotas.filter(c => c.pagada).length}/${r.cuotas.length}`, 'Estado': getEstadoAsist(r)
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
                {OPCIONES_MONTO.map(o => (
                  <div key={o.value} className={`monto-opt${montoAsist === o.value ? ' selected' : ''}`} onClick={() => setMontoAsist(o.value)}>
                    <div className="monto-value">${o.value}</div><div className="monto-label">{o.label}</div><div className="monto-total">Total: ${o.total} · {o.cuotas} meses</div>
                  </div>
                ))}
                <div className={`monto-opt${montoAsist === 0 ? ' selected' : ''}`} onClick={() => setMontoAsist(0)}>
                  <div className="monto-value" style={{ fontSize: '1.1rem' }}>Otro</div><div className="monto-label">Personalizado</div><div className="monto-total">Ingresar valor</div>
                </div>
              </div>
              {montoAsist === 0 && (
                <div style={{ marginTop: 10 }}>
                  <label className="field-label">💰 Ingresa el monto del préstamo ($)</label>
                  <input type="number" className="field-input" placeholder="Ej: 150" min="1" step="1"
                    value={montoCustom} onChange={e => setMontoCustom(e.target.value)} />
                  {montoReal > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--accent-color)', fontWeight: 700, marginTop: 4 }}>Total a pagar: ${totalPagar.toFixed(2)} (10% de interés · 6 meses)</div>}
                </div>
              )}
            </div>
            <div className="grid-3">
              <div className="field-group"><label className="field-label">🔢 N° Socio</label><input type="number" className="field-input" placeholder="1-61" min="1" max="61" value={numSocio} onChange={e => setNumSocio(e.target.value)} /></div>
              <div className="field-group" style={{ gridColumn: 'span 2' }}><label className="field-label">👤 Nombre</label><input type="text" className="field-input" placeholder="Nombre completo" value={nombre} onChange={e => setNombre(e.target.value)} /></div>
            </div>
            <div className="field-group"><label className="field-label">🪪 Cédula</label><input type="text" className="field-input" placeholder="1234567890" maxLength="10" value={cedula} onChange={e => setCedula(e.target.value)} /></div>

            <div className="field-group" style={{ marginTop: 4 }}>
              <label className="field-label">🤝 Socio Garante (N°)</label>
              <input type="number" className="field-input" placeholder="N° del socio que garantiza este crédito" min="1" max="61" value={garanteNum} onChange={e => setGaranteNum(e.target.value)} />
              {garanteNombre && !garanteError && <div style={{ fontSize: '0.78rem', color: 'var(--green)', fontWeight: 700, marginTop: 4 }}>✅ Garante: {garanteNombre}</div>}
              {garanteError && <div style={{ fontSize: '0.78rem', color: 'var(--red)', fontWeight: 700, marginTop: 4 }}>🚫 {garanteError}</div>}
            </div>

            <div className="grid-2">
              <div className="field-group"><label className="field-label">📅 Fecha Retiro</label><input type="date" className="field-input" value={fechaRetiro} onChange={e => setFechaRetiro(e.target.value)} /></div>
              <div className="field-group"><label className="field-label">⏰ 1ª Cuota Máx.</label><input type="date" className="field-input" readOnly style={{ opacity: 0.7 }} value={fechaLimitePrimera} /></div>
            </div>
            {fechaRetiro && (
              <div className="info-box info-box-blue"><span>📌</span><div>Retiro: <strong>{formatDate(fechaRetiro)}</strong> → 1ª cuota máx: <strong>{formatDate(fechaLimitePrimera)}</strong></div></div>
            )}
            {cuotasPreview.length > 0 && (
              <div className="info-box info-box-green"><span>📋</span><div>
                <strong>Fechas límite de las {numCuotas} cuotas:</strong><br />
                {cuotasPreview.map(c => <React.Fragment key={c.num}>C{c.num}: <strong>{formatDate(c.fechaLimite)}</strong> · ${c.monto.toFixed(2)} &nbsp;</React.Fragment>)}
              </div></div>
            )}
            <div className="field-group" style={{ marginTop: 10 }}><label className="field-label">📝 Observaciones</label><input type="text" className="field-input" placeholder="Notas..." value={obs} onChange={e => setObs(e.target.value)} /></div>
            <button className="btn btn-primary btn-full" style={{ marginTop: 10 }} onClick={guardarAsistencia}>💾 Guardar</button>
          </div>
          <div className="info-box info-box-blue"><span>📌</span><div>30 días + 5 de gracia = 35 días máx. tras el retiro · $600 a 12 meses o $300 a 6 meses, siempre $55/mes</div></div>
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
          ) : listaFiltrada.map(r => (
            <RegCard key={r.firebaseId} r={r} onAbrirCuotas={abrirCuotas} onEliminar={eliminarAsist} />
          ))}
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

// ===================== MÓDULO CUOTA ADMINISTRATIVA =====================

// Fila de socio memoizada (misma razón de rendimiento que en Asistencia)
const SocioRow = React.memo(function SocioRow({ s, onAbrir }) {
  const aldia = estaAlDia(s);
  const pagos = s.pagos || {};
  const mesesPagados = Object.values(pagos).filter(p => p.pagado).length;
  const multasCobradas = Object.values(pagos).reduce((sum, p) => sum + (p.multaPagada ? (p.multa || 0) : 0), 0);
  const multasPendientes = Object.values(pagos).reduce((sum, p) => sum + (!p.multaPagada && p.multa > 0 ? p.multa : 0), 0);
  return (
    <div className="socio-row" onClick={() => onAbrir(s.num)}>
      <div className="socio-num">#{String(s.num).padStart(2, '0')}</div>
      <div className="socio-info">
        <div className="socio-nombre">{s.nombre}</div>
        <div className="socio-cedula">CI: {s.cedula}</div>
      </div>
      <div className="socio-stats">
        <div className="socio-stat-item">{mesesPagados}/12 <span>meses</span></div>
        {multasPendientes > 0 && <div className="socio-stat-item multa">${multasPendientes.toFixed(2)} <span>multa pend.</span></div>}
        {multasCobradas > 0 && <div className="socio-stat-item" style={{ color: 'var(--green)' }}>${multasCobradas.toFixed(2)} <span>multa cobrada</span></div>}
      </div>
      <span className={`status-chip ${aldia ? 'chip-verde' : 'chip-rojo'}`}>{aldia ? '✅ Al día' : '⚠️ Atraso'}</span>
      <span className="arrow-icon">›</span>
    </div>
  );
});

// Cuentas <select> reutilizable
function SelectCuenta({ value, onChange }) {
  return (
    <select className="field-input" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">-- Seleccionar cuenta --</option>
      {CUENTAS.map(c => <option key={c.num} value={c.num}>{c.num} — {c.desc}</option>)}
    </select>
  );
}

function ModuloAdmin({ showToast, setDialogConfig, socios, sociosCargando, cargarSocios }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtroSocios, setFiltroSocios] = useState('todos');
  const [socioSeleccionado, setSocioSeleccionado] = useState(null); // num del socio abierto (carpeta)
  const [anioSeleccionado, setAnioSeleccionado] = useState(new Date().getFullYear());
  const [pagoModal, setPagoModal] = useState(null); // { numSocio, anio, mes } o null
  const [editModal, setEditModal] = useState(null); // num o null

  const socio = socioSeleccionado ? socios.find(s => s.num === socioSeleccionado) : null;

  const guardarSocioDoc = async (s) => {
    // merge:true asegura que esto NUNCA reemplace el documento completo — solo actualiza
    // los campos indicados, sin poder borrar accidentalmente otros datos del socio.
    await setDoc(doc(db, 'socios', String(s.num)), { num: s.num, nombre: s.nombre, cedula: s.cedula }, { merge: true });
  };

  // Guarda SOLO el mes puntual que se está editando, tocando únicamente ese campo anidado
  // (pagos.2026-03, por ejemplo) — estructuralmente no puede afectar ningún otro mes ni socio.
  const guardarPagoMes = async (numSocio, key, pagoData) => {
    await updateDoc(doc(db, 'socios', String(numSocio)), { [`pagos.${key}`]: pagoData });
  };

  // ---------- LISTA DE SOCIOS ----------
  let listaFiltrada = [...socios];
  if (busqueda.trim()) {
    const q = busqueda.toLowerCase();
    listaFiltrada = listaFiltrada.filter(s => s.nombre.toLowerCase().includes(q) || String(s.num).includes(q) || s.cedula.includes(q));
  }
  if (filtroSocios === 'aldia') listaFiltrada = listaFiltrada.filter(s => estaAlDia(s));
  if (filtroSocios === 'atraso') listaFiltrada = listaFiltrada.filter(s => !estaAlDia(s));

  let totalCuotas = 0, cuotasPagadas = 0, multasCobradasTotal = 0, multasPendientesTotal = 0;
  socios.forEach(s => {
    Object.values(s.pagos || {}).forEach(p => {
      if (p.pagado) { cuotasPagadas++; totalCuotas += (p.monto || 25); }
      if (p.multaPagada && p.multa > 0) multasCobradasTotal += p.multa;
      if (!p.multaPagada && p.multa > 0) multasPendientesTotal += p.multa;
    });
  });
  const faltanCuotas = (socios.length * 12) - cuotasPagadas;
  const dineroPorRecaudar = faltanCuotas * 25;

  const exportarAdminExcel = () => {
    if (!window.XLSX) { showToast('El exportador todavía está cargando, intenta de nuevo.', '⚠️'); return; }
    const wb = window.XLSX.utils.book_new();
    const data = [];
    socios.forEach(s => {
      MESES.forEach((mes, i) => {
        const anio = new Date().getFullYear();
        const key = `${anio}-${String(i + 1).padStart(2, '0')}`;
        const p = (s.pagos || {})[key] || {};
        const cuentaDesc = CUENTAS.find(c => c.num === p.cuenta);
        const multaCuentaDesc = CUENTAS.find(c => c.num === p.multaCuenta);
        data.push({
          '#Socio': s.num, 'Nombre': s.nombre, 'Cédula': s.cedula, 'Mes': mes, 'Año': anio,
          'Monto Cuota': p.monto || 25, 'Fecha Pago': p.fechaPago ? formatDate(p.fechaPago) : '—',
          'Pagado': p.pagado ? 'SÍ' : 'NO', 'Cuenta Cuota': p.cuenta ? `${p.cuenta} (${cuentaDesc?.desc || ''})` : '—',
          'Multa': p.multa || 0, 'Multa Pagada': p.multaPagada ? 'SÍ' : 'NO',
          'Fecha Pago Multa': p.multaFechaPago ? formatDate(p.multaFechaPago) : '—',
          'Cuenta Multa': p.multaCuenta ? `${p.multaCuenta} (${multaCuentaDesc?.desc || ''})` : '—',
          'Novedad': p.novedad || ''
        });
      });
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data), 'Cuota Administrativa');
    window.XLSX.writeFile(wb, `CuotaAdmin_${today().replace(/-/g, '')}.xlsx`);
    showToast('Excel exportado', '📊');
  };

  const exportarSocioExcel = (num) => {
    if (!window.XLSX) { showToast('El exportador todavía está cargando, intenta de nuevo.', '⚠️'); return; }
    const s = socios.find(s => s.num === num);
    if (!s) return;
    const wb = window.XLSX.utils.book_new();
    const data = [];
    Object.keys(s.pagos || {}).sort().forEach(key => {
      const [anio, mes] = key.split('-');
      const p = s.pagos[key];
      const cuentaDesc = CUENTAS.find(c => c.num === p.cuenta);
      const multaCuentaDesc = CUENTAS.find(c => c.num === p.multaCuenta);
      data.push({
        'Período': `${MESES[parseInt(mes) - 1]} ${anio}`, 'Monto': p.monto || 25,
        'Fecha Pago': p.fechaPago ? formatDate(p.fechaPago) : '—', 'Pagado': p.pagado ? 'SÍ' : 'NO',
        'Cuenta': p.cuenta ? `${p.cuenta} (${cuentaDesc?.desc || ''})` : '—',
        'Multa': p.multa || 0, 'Multa Pagada': p.multaPagada ? 'SÍ' : 'NO',
        'Fecha Pago Multa': p.multaFechaPago ? formatDate(p.multaFechaPago) : '—',
        'Cuenta Multa': p.multaCuenta ? `${p.multaCuenta} (${multaCuentaDesc?.desc || ''})` : '—',
        'Novedad': p.novedad || ''
      });
    });
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(data), `Socio ${num}`);
    window.XLSX.writeFile(wb, `Socio${num}_${s.nombre.split(' ')[0]}_${today().replace(/-/g, '')}.xlsx`);
    showToast('Excel del socio exportado', '📊');
  };

  // ---------- VISTA: CARPETA DE UN SOCIO ----------
  if (socio) {
    const pagos = socio.pagos || {};
    const anioActual = new Date().getFullYear();
    const years = new Set();
    Object.keys(pagos).forEach(k => years.add(k.split('-')[0]));
    years.add(String(anioActual));
    const yearsArr = [...years].sort();

    const mesesPagados = Object.values(pagos).filter(p => p.pagado).length;
    const multasCobradas = Object.values(pagos).reduce((s, p) => s + (p.multaPagada ? (p.multa || 0) : 0), 0);
    const multasPendientes = Object.values(pagos).reduce((s, p) => s + (!p.multaPagada && p.multa > 0 ? p.multa : 0), 0);
    const totalCuotasSocio = Object.values(pagos).filter(p => p.pagado).reduce((s, p) => s + (p.monto || 25), 0);
    const aldia = estaAlDia(socio);

    const agregarAnio = () => {
      const anio = window.prompt('Ingresa el año a agregar (ej: 2027):');
      if (!anio || isNaN(anio)) return;
      setAnioSeleccionado(parseInt(anio));
    };

    return (
      <>
        <div className="glass-card" style={{ marginBottom: 14 }}>
          <div className="card-header">
            <button className="btn btn-ghost btn-sm" onClick={() => setSocioSeleccionado(null)}>← Volver</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => setEditModal(socio.num)}>✏️ Editar</button>
              <button className="btn btn-green btn-sm" onClick={() => exportarSocioExcel(socio.num)}>📊 Excel</button>
            </div>
          </div>
          <div className="socio-card-header">
            <div className="socio-avatar">#{String(socio.num).padStart(2, '0')}</div>
            <div>
              <div className="socio-card-nombre">{socio.nombre}</div>
              <div className="socio-card-cedula">🪪 {socio.cedula}</div>
              <span className={`status-chip ${aldia ? 'chip-verde' : 'chip-rojo'}`} style={{ marginTop: 6, display: 'inline-flex' }}>{aldia ? '✅ Totalmente al día' : '⚠️ Con atraso'}</span>
            </div>
          </div>
          <div className="stats-grid" style={{ marginTop: 14 }}>
            <div className="stat-card"><div className="stat-val green-val">{mesesPagados}</div><div className="stat-lbl">Meses Pagados</div></div>
            <div className="stat-card"><div className="stat-val">${totalCuotasSocio.toFixed(0)}</div><div className="stat-lbl">💰 Cuotas</div></div>
            <div className="stat-card"><div className="stat-val green-val">${multasCobradas.toFixed(2)}</div><div className="stat-lbl">✅ Multas Cobradas</div></div>
            {multasPendientes > 0 && <div className="stat-card"><div className="stat-val red-val">${multasPendientes.toFixed(2)}</div><div className="stat-lbl">🔴 Multas Pendientes</div></div>}
          </div>
        </div>
        <div className="years-nav">
          {yearsArr.map(y => (
            <button key={y} className={`year-btn ${parseInt(y) === anioSeleccionado ? 'active' : ''}`} onClick={() => setAnioSeleccionado(parseInt(y))}>{y}</button>
          ))}
          <button className="year-btn" onClick={agregarAnio}>+ Año</button>
        </div>
        <div className="glass-card">
          <div className="card-title" style={{ marginBottom: 16 }}>📅 Registro {anioSeleccionado}</div>
          <div className="meses-grid">
            {MESES.map((mesNombre, idx) => {
              const mesNum = idx + 1;
              const key = `${anioSeleccionado}-${String(mesNum).padStart(2, '0')}`;
              const pago = pagos[key];
              const limite = ultimoDiaMes(anioSeleccionado, mesNum);
              const hoy = today();
              const vencido = hoy > limite && !pago?.pagado;

              let estadoClass = 'mes-pendiente';
              let estadoLabel = '⏳ Pendiente';
              if (pago?.pagado) {
                if (pago.multa > 0 && !pago.multaPagada) { estadoClass = 'mes-multa-pend'; estadoLabel = '💰 Cuota ✅ · Multa 🔴'; }
                else { estadoClass = 'mes-pagado'; estadoLabel = '✅ Pagado'; }
              } else if (vencido) { estadoClass = 'mes-vencido'; estadoLabel = '🔴 Vencido'; }

              return (
                <div className={`mes-card ${estadoClass}`} key={mesNum} onClick={() => setPagoModal({ numSocio: socio.num, anio: anioSeleccionado, mes: mesNum })}>
                  <div className="mes-nombre">{mesNombre}</div>
                  <div className="mes-estado">{estadoLabel}</div>
                  {pago?.pagado ? (
                    <div className="mes-detalle">
                      <div>💰 ${pago.monto || 25} · 📅 {formatDate(pago.fechaPago)}</div>
                      {pago.cuenta && <div className="mes-cuenta">🏦 {pago.cuenta}</div>}
                      {pago.multa > 0 ? (
                        <>
                          <div className="mes-separador"></div>
                          {pago.multaPagada ? (
                            <>
                              <div className="mes-aldia">✅ Multa ${pago.multa.toFixed(2)} cobrada el {formatDate(pago.multaFechaPago)}</div>
                              {pago.multaCuenta && <div className="mes-cuenta">🏦 {pago.multaCuenta}</div>}
                            </>
                          ) : <div className="mes-multa">🔴 Multa pendiente: ${pago.multa.toFixed(2)}</div>}
                        </>
                      ) : <div className="mes-aldia">✅ Sin multa</div>}
                      {pago.novedad && <div className="mes-novedad">📝 {pago.novedad}</div>}
                    </div>
                  ) : (
                    <>
                      <div className="mes-limite">Límite: {formatDate(limite)}</div>
                      {vencido && <div className="mes-multa-est">Multa est.: ${calcularMultaHoy(anioSeleccionado, mesNum)}</div>}
                    </>
                  )}
                  <div className="mes-action-hint">Toca para {pago?.pagado ? 'editar' : 'registrar'}</div>
                </div>
              );
            })}
          </div>
        </div>

        {pagoModal && pagoModal.numSocio === socio.num && (
          <ModalPago
            socio={socio}
            pagoModal={pagoModal}
            onClose={() => setPagoModal(null)}
            onGuardado={async () => { await cargarSocios(); }}
            guardarPagoMes={guardarPagoMes}
            showToast={showToast}
          />
        )}

        {editModal === socio.num && (
          <ModalEditarSocio
            socio={socio}
            onClose={() => setEditModal(null)}
            guardarSocioDoc={guardarSocioDoc}
            onGuardado={cargarSocios}
            showToast={showToast}
          />
        )}
      </>
    );
  }

  // ---------- VISTA: LISTA GENERAL ----------
  return (
    <>
      <div className="glass-card" style={{ marginBottom: 14 }}>
        <div className="card-header">
          <div className="card-title">🏠 Cuota Administrativa</div>
          <button className="btn btn-green btn-sm" onClick={exportarAdminExcel}>📊 Excel</button>
        </div>
        <div className="filter-bar">
          <input type="text" className="search-input" placeholder="🔍 Buscar socio..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          {['todos', 'aldia', 'atraso'].map(f => (
            <button key={f} className={`filter-chip${filtroSocios === f ? ' active' : ''}`} onClick={() => setFiltroSocios(f)}>
              {f === 'todos' ? 'Todos' : f === 'aldia' ? '✅ Al día' : '⚠️ Atraso'}
            </button>
          ))}
        </div>
        {sociosCargando ? <SkeletonList count={4} /> : listaFiltrada.length === 0 ? (
          <div className="empty-state"><div className="empty-emoji">🔍</div><div className="empty-title">Sin resultados</div></div>
        ) : listaFiltrada.map(s => <SocioRow key={s.firebaseId} s={s} onAbrir={setSocioSeleccionado} />)}
      </div>
      <div className="glass-card">
        <div className="card-title" style={{ marginBottom: 14 }}>📊 Resumen General</div>
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-val green-val">{cuotasPagadas}</div><div className="stat-lbl">✅ Cuotas Pagadas</div></div>
          <div className="stat-card"><div className="stat-val orange-val">{faltanCuotas}</div><div className="stat-lbl">⏳ Faltantes</div></div>
          <div className="stat-card"><div className="stat-val">${totalCuotas.toFixed(0)}</div><div className="stat-lbl">💰 Recaudado</div></div>
          <div className="stat-card"><div className="stat-val orange-val">${dineroPorRecaudar.toFixed(0)}</div><div className="stat-lbl">⏳ Por Recaudar</div></div>
          <div className="stat-card"><div className="stat-val green-val">${multasCobradasTotal.toFixed(2)}</div><div className="stat-lbl">✅ Multas Cobradas</div></div>
          <div className="stat-card"><div className="stat-val red-val">${multasPendientesTotal.toFixed(2)}</div><div className="stat-lbl">🔴 Multas Pendientes</div></div>
        </div>
      </div>
    </>
  );
}

// ---------- MODAL: REGISTRAR/EDITAR PAGO DE UN MES ----------
function ModalPago({ socio, pagoModal, onClose, guardarPagoMes, onGuardado, showToast }) {
  const { anio, mes } = pagoModal;
  const key = `${anio}-${String(mes).padStart(2, '0')}`;
  const pagoExistente = (socio.pagos || {})[key] || {};
  const limite = ultimoDiaMes(anio, mes);

  const [monto, setMonto] = useState(pagoExistente.monto || 25);
  const [fecha, setFecha] = useState(pagoExistente.fechaPago || today());
  const [cuenta, setCuenta] = useState(pagoExistente.cuenta || '');
  const [novedad, setNovedad] = useState(pagoExistente.novedad || '');
  const [pagado, setPagado] = useState(!!pagoExistente.pagado);
  const [multaPagada, setMultaPagada] = useState(!!pagoExistente.multaPagada);
  const [multaFechaPago, setMultaFechaPago] = useState(pagoExistente.multaFechaPago || today());
  const [multaCuenta, setMultaCuenta] = useState(pagoExistente.multaCuenta || '11010080770');

  const multaCalc = calcularMulta(anio, mes, fecha);
  const hayMulta = multaCalc > 0 || pagoExistente.multa > 0;

  const guardar = async () => {
    if (!fecha) { showToast('Ingresa la fecha de pago', '⚠️'); return; }
    const multa = pagado ? calcularMulta(anio, mes, fecha) : 0;
    const pagoData = {
      pagado, monto: parseFloat(monto) || 25,
      fechaPago: pagado ? fecha : null,
      multa,
      multaPagada: multa > 0 ? multaPagada : false,
      multaFechaPago: multa > 0 && multaPagada ? multaFechaPago : null,
      multaCuenta: multa > 0 && multaPagada ? multaCuenta : '',
      cuenta, novedad
    };
    try {
      // Solo toca pagos.<key> de ESTE socio — no puede tocar ningún otro mes, socio ni campo.
      await guardarPagoMes(socio.num, key, pagoData);
      onClose();
      if (pagado && window.confetti) window.confetti({ particleCount: 60, spread: 50, origin: { y: 0.7 }, colors: ['#667eea', '#059669', '#764ba2'] });
      showToast(`${MESES[mes - 1]} ${anio} guardado`, '✅');
      await onGuardado();
    } catch (e) {
      showToast('Error: ' + e.message, '❌');
    }
  };

  return (
    <div className="modal-overlay open">
      <div className="modal">
        <div className="modal-title">💳 {MESES[mes - 1]} {anio} — #{String(socio.num).padStart(2, '0')}</div>
        <div style={{ fontWeight: 700, color: 'var(--empty-text)', marginBottom: 10 }}>{socio.nombre}</div>

        <div className="info-box info-box-blue" style={{ marginBottom: 12 }}><span>📅</span><div>Límite de pago: <strong>{formatDate(limite)}</strong></div></div>

        <div className="seccion-pago">
          <div className="seccion-titulo">💰 Cuota Administrativa</div>
          <div className="field-group">
            <label className="field-label">💰 Monto Cuota ($)</label>
            <input type="number" className="field-input" value={monto} step="0.01" min="0" onChange={e => setMonto(e.target.value)} />
            <div style={{ fontSize: '0.7rem', color: 'var(--empty-text)', marginTop: 4, fontWeight: 700 }}>Editable en caso de pago parcial o incorrecto</div>
          </div>
          <div className="field-group">
            <label className="field-label">📅 Fecha Real de Pago</label>
            <input type="date" className="field-input" value={fecha} onChange={e => setFecha(e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">🏦 Cuenta de Depósito</label>
            <SelectCuenta value={cuenta} onChange={setCuenta} />
          </div>
          <div className="field-group">
            <label className="field-label">📝 Novedades del Pago</label>
            <input type="text" className="field-input" placeholder="Observaciones..." value={novedad} onChange={e => setNovedad(e.target.value)} />
          </div>
          <div className="field-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" checked={pagado} onChange={e => setPagado(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent-color)' }} id="chk-pagado" />
            <label htmlFor="chk-pagado" style={{ fontWeight: 800, cursor: 'pointer' }}>Marcar cuota como PAGADA</label>
          </div>
        </div>

        <div className="seccion-pago seccion-multa">
          <div className="seccion-titulo">🔴 Multa por Atraso</div>
          <div className="info-box" style={hayMulta
            ? { background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', color: 'var(--red)', marginBottom: 10 }
            : { background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.25)', color: 'var(--green)', marginBottom: 10 }}>
            <span>{hayMulta ? '🔴' : '✅'}</span>
            <div>
              {multaCalc > 0
                ? <>Multa calculada: <strong>${multaCalc.toFixed(2)}</strong> (se actualiza con la fecha)</>
                : pagoExistente.multa > 0 ? <>Multa registrada: <strong>${pagoExistente.multa.toFixed(2)}</strong></> : 'Sin multa — pagó a tiempo'}
            </div>
          </div>

          {hayMulta ? (
            <>
              <div className="field-group">
                <label className="field-label">📅 Fecha de Pago de la Multa</label>
                <input type="date" className="field-input" value={multaFechaPago} onChange={e => setMultaFechaPago(e.target.value)} />
              </div>
              <div className="field-group">
                <label className="field-label">🏦 Cuenta donde pagó la Multa</label>
                <SelectCuenta value={multaCuenta} onChange={setMultaCuenta} />
              </div>
              <div className="field-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" checked={multaPagada} onChange={e => setMultaPagada(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--red)' }} id="chk-multa" />
                <label htmlFor="chk-multa" style={{ fontWeight: 800, cursor: 'pointer', color: 'var(--red)' }}>Marcar multa como PAGADA</label>
              </div>
            </>
          ) : <div style={{ fontSize: '0.82rem', color: 'var(--green)', fontWeight: 700 }}>✅ No hay multa para este mes.</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost btn-full" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary btn-full" onClick={guardar}>💾 Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ---------- MODAL: EDITAR DATOS DEL SOCIO ----------
function ModalEditarSocio({ socio, onClose, guardarSocioDoc, onGuardado, showToast }) {
  const [nombre, setNombre] = useState(socio.nombre);
  const [cedula, setCedula] = useState(socio.cedula);

  const guardar = async () => {
    const n = nombre.trim().toUpperCase();
    const c = cedula.trim();
    if (!n || !c) { showToast('Completa todos los campos', '⚠️'); return; }
    try {
      await guardarSocioDoc({ ...socio, nombre: n, cedula: c });
      onClose();
      showToast('Socio actualizado', '✅');
      await onGuardado();
    } catch (e) {
      showToast('Error: ' + e.message, '❌');
    }
  };

  return (
    <div className="modal-overlay open">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-title">✏️ Editar Socio #{String(socio.num).padStart(2, '0')}</div>
        <div className="field-group">
          <label className="field-label">👤 Nombre</label>
          <input type="text" className="field-input" value={nombre} onChange={e => setNombre(e.target.value)} />
        </div>
        <div className="field-group">
          <label className="field-label">🪪 Cédula</label>
          <input type="text" className="field-input" value={cedula} onChange={e => setCedula(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost btn-full" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary btn-full" onClick={guardar}>💾 Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ===================== APP PRINCIPAL =====================
export default function App() {
  const [user, setUser] = useState(undefined); // undefined = cargando, null = sin sesión
  const [modulo, setModulo] = useState('admin');
  const [socios, setSocios] = useState([]);
  const [sociosCargando, setSociosCargando] = useState(true);
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

  const cargarSocios = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'socios'));
      const lista = [];
      snap.forEach(d => lista.push({ ...d.data(), firebaseId: d.id }));
      lista.sort((a, b) => a.num - b.num);
      setSocios(lista);
    } catch (e) {
      console.error(e);
    } finally {
      setSociosCargando(false);
    }
  }, []);

  useEffect(() => { if (user) cargarSocios(); }, [user, cargarSocios]);

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
        {modulo === 'admin' && <ModuloAdmin showToast={showToast} setDialogConfig={setDialogConfig} socios={socios} sociosCargando={sociosCargando} cargarSocios={cargarSocios} />}
        {modulo === 'asistencia' && <ModuloAsistencia showToast={showToast} setDialogConfig={setDialogConfig} socios={socios} />}
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
