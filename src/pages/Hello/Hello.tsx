export default function HelloWorld() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0f172a',
      color: '#f1f5f9',
      fontFamily: 'sans-serif',
      fontSize: 32,
      zIndex: 99999,
    }}>
      Hello World - React 渲染正常
    </div>
  );
}
