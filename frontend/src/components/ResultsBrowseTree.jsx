import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

function TreeNode({ node, depth, expanded, selectedKeys, onToggle, onSelect }) {
  const hasChildren = !!node.children?.length;
  const isExpanded = expanded.has(node.key);
  const isSelected = selectedKeys.has(node.key);
  return (
    <li className="min-w-0" data-testid={`browse-tree-node-${node.testId || node.key}`}>
      <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        {hasChildren ? (
          <button type="button" aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.label}`}
            aria-expanded={isExpanded} onClick={() => onToggle(node.key)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : <span aria-hidden="true" className="w-8 shrink-0" />}
        <button type="button" data-testid={node.testId}
          aria-current={isSelected ? "true" : undefined}
          onClick={() => onSelect(node)}
          className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${isSelected ? "bg-safety font-semibold text-white" : "text-white/90 hover:bg-white/10 hover:text-white"}`}>
          {node.Icon && <node.Icon className="h-4 w-4 shrink-0" />}
          <span className="truncate">{node.label}</span>
          {node.detail && <span className="ml-auto shrink-0 text-xs text-white/55">{node.detail}</span>}
        </button>
      </div>
      {hasChildren && isExpanded && (
        <ul className="mt-1 space-y-1 border-l border-white/15">
          {node.children.map((child) => (
            <TreeNode key={child.key} node={child} depth={depth + 1} expanded={expanded}
              selectedKeys={selectedKeys} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ResultsBrowseTree({ nodes, selectedPath = [], onSelect, actions }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set(selectedPath.map((node) => node.key)));
  const pathKeys = selectedPath.map((node) => node.key).join("|");
  const selectedKeys = new Set(selectedPath.map((node) => node.key));

  useEffect(() => {
    setExpanded(new Set(selectedPath.map((node) => node.key)));
  }, [pathKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleNode = (key) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectNode = (node) => {
    onSelect?.(node);
    if (node.children?.length) {
      setExpanded((current) => new Set([...current, node.key]));
    } else {
      setOpen(false);
    }
  };
  return (
    <nav className="mt-4 w-full max-w-5xl rounded-2xl border border-white/25 bg-white/10 px-3 py-2.5 shadow-sm backdrop-blur-sm sm:px-4"
      aria-label="Results hierarchy" data-testid="browse-nav">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" data-testid="browse-tree-toggle" aria-expanded={open}
          aria-controls="results-browse-tree" onClick={() => setOpen((value) => !value)}
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl text-left text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-white/70" /> : <ChevronRight className="h-4 w-4 shrink-0 text-white/70" />}
          <span className="truncate text-sm font-semibold" data-testid="browse-tree-label">Browse results</span>
          <span className="sr-only">{open ? "Collapse results tree" : "Expand results tree"}</span>
        </button>
      </div>
      {open && (
        <div id="results-browse-tree" className="mt-2 max-h-[40vh] overflow-y-auto border-t border-white/15 pt-2" data-testid="browse-tree-content">
          <ul className="space-y-1">
            {nodes.map((node) => (
              <TreeNode key={node.key} node={node} depth={0} expanded={expanded}
                selectedKeys={selectedKeys} onToggle={toggleNode} onSelect={selectNode} />
            ))}
          </ul>
          {open && actions && <div className="mt-2 flex flex-wrap justify-end gap-2 border-t border-white/15 pt-2">{actions}</div>}
        </div>
      )}
    </nav>
  );
}
