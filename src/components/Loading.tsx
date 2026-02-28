

export default function Loading({ children, text = '', isLoading }: { children: React.ReactNode, text?: string, isLoading: Boolean }) {
  // 加载中状态
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{
          width: '50px',
          height: '50px',
          border: '4px solid rgba(255, 255, 255, 0.3)',
          borderTopColor: 'white',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }}></div>
        <p style={{
          color: 'white',
          fontSize: '16px',
          fontWeight: '600'
        }}>
          {text}
        </p>
        <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
      </div>
    );
  }
  return <>{children}</>;
}