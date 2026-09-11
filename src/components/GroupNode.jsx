import React from 'react';

export default function GroupNode({ data, width, height }) {
  return (
    <div
      className="group-node-card"
      style={{
        width: width ? `${width}px` : '100%',
        height: height ? `${height}px` : '100%',
        backgroundColor: data.color ? `${data.color}15` : 'rgba(2, 132, 199, 0.08)',
        borderColor: data.color || '#0284c7',
      }}
    >
      <div
        className="group-node-header"
        style={{
          backgroundColor: data.color || '#0284c7',
        }}
      >
        <span className="group-node-title">📦 {data.label}</span>
        {data.onDelete && (
          <button
            type="button"
            className="group-node-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              data.onDelete(data.id);
            }}
            title="Supprimer cet objet métier"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}